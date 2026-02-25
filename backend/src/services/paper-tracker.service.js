/**
 * Paper Tracker Orchestrator
 *
 * Coordinates all tracker sources (HuggingFace, Google Scholar, Twitter),
 * deduplicates against existing documents, auto-imports new arXiv papers,
 * and runs on a configurable schedule.
 */

const { getDb } = require('../db');
const s3Service = require('./s3.service');
const documentService = require('./document.service');
const arxivService = require('./arxiv.service');
const hfTracker = require('./hf-tracker.service');
const twitterTracker = require('./twitter-tracker.service');
const alphaxivTracker = require('./alphaxiv-tracker.service');
const twitterPlaywrightTracker = require('./twitter-playwright-tracker.service');
const financeTracker = require('./finance-tracker.service');

const DEFAULT_USER_ID = 'czk';
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours (daily)
const DEFAULT_TWITTER_PLAYWRIGHT_INTERVAL_HOURS = 24;
const DEFAULT_SOURCE_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.TRACKER_SOURCE_TIMEOUT_MS || String(90 * 1000), 10);
  if (!Number.isFinite(raw)) return 90 * 1000;
  return Math.max(5 * 1000, Math.min(raw, 15 * 60 * 1000));
})();

let _intervalHandle = null;
let _lastRunAt = null;
let _lastRunResult = null;
let _running = false;

function isDiscoveryOnlySource(type) {
  return ['hf', 'arxiv_authors', 'alphaxiv', 'twitter', 'finance'].includes(String(type || '').toLowerCase());
}

function withTimeout(task, timeoutMs, label) {
  const safeMs = Number.isFinite(timeoutMs) ? Math.max(5000, Math.min(timeoutMs, 15 * 60 * 1000)) : DEFAULT_SOURCE_TIMEOUT_MS;
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(`${label}_timeout_${safeMs}ms`)), safeMs);
  });
  return Promise.race([
    Promise.resolve().then(task),
    timeoutPromise,
  ]).finally(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  });
}

function getSourceTimeoutMs(sourceType, sourceConfig = {}) {
  const configTimeout = parseInt(sourceConfig?.timeoutMs, 10);
  if (Number.isFinite(configTimeout)) {
    return Math.max(5000, Math.min(configTimeout, 15 * 60 * 1000));
  }
  const envKey = `TRACKER_${String(sourceType || '').toUpperCase()}_TIMEOUT_MS`;
  const envTimeout = parseInt(process.env[envKey] || '', 10);
  if (Number.isFinite(envTimeout)) {
    return Math.max(5000, Math.min(envTimeout, 15 * 60 * 1000));
  }
  return DEFAULT_SOURCE_TIMEOUT_MS;
}

// ─── DB Helpers ────────────────────────────────────────────────────────────

async function getSources() {
  const db = getDb();
  const result = await db.execute(`SELECT * FROM tracker_sources ORDER BY created_at ASC`);
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    config: JSON.parse(r.config || '{}'),
    enabled: r.enabled === 1,
    lastCheckedAt: r.last_checked_at,
    createdAt: r.created_at,
  }));
}

async function getEnabledSources() {
  const db = getDb();
  const result = await db.execute(
    `SELECT * FROM tracker_sources WHERE enabled = 1 ORDER BY created_at ASC`
  );
  return result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    config: JSON.parse(r.config || '{}'),
    enabled: true,
    lastCheckedAt: r.last_checked_at,
  }));
}

async function addSource(type, name, config = {}) {
  const db = getDb();
  const result = await db.execute({
    sql: `INSERT INTO tracker_sources (type, name, config) VALUES (?, ?, ?)`,
    args: [type, name, JSON.stringify(config)],
  });
  return Number(result.lastInsertRowid);
}

async function updateSource(id, updates) {
  const db = getDb();
  const sets = [];
  const args = [];

  if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
  if (updates.config !== undefined) { sets.push('config = ?'); args.push(JSON.stringify(updates.config)); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); args.push(updates.enabled ? 1 : 0); }

  if (sets.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE tracker_sources SET ${sets.join(', ')} WHERE id = ?`, args });
}

async function deleteSource(id) {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM tracker_sources WHERE id = ?`, args: [id] });
}

async function markSourceChecked(id) {
  const db = getDb();
  await db.execute({
    sql: `UPDATE tracker_sources SET last_checked_at = CURRENT_TIMESTAMP WHERE id = ?`,
    args: [id],
  });
}

// ─── Deduplication ─────────────────────────────────────────────────────────

async function isAlreadySeen(arxivId) {
  const db = getDb();
  // Check tracker_seen_papers first (fast)
  const r1 = await db.execute({
    sql: `SELECT 1 FROM tracker_seen_papers WHERE arxiv_id = ? LIMIT 1`,
    args: [arxivId],
  });
  if (r1.rows.length > 0) return true;

  // Check existing documents by originalUrl containing the arXiv ID
  const r2 = await db.execute({
    sql: `SELECT 1 FROM documents WHERE original_url LIKE ? LIMIT 1`,
    args: [`%arxiv.org%${arxivId}%`],
  });
  return r2.rows.length > 0;
}

async function markAsSeen(arxivId, sourceType) {
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO tracker_seen_papers (arxiv_id, source_type) VALUES (?, ?)`,
    args: [arxivId, sourceType],
  });
}

async function getExistingArchivedPostUrlSet(postUrls = []) {
  const cleaned = [...new Set(postUrls.filter(Boolean))];
  if (cleaned.length === 0) return new Set();

  const db = getDb();
  const existing = new Set();
  const chunkSize = 50;

  for (let i = 0; i < cleaned.length; i += chunkSize) {
    const chunk = cleaned.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await db.execute({
      sql: `SELECT post_url FROM tracker_archived_posts WHERE post_url IN (${placeholders})`,
      args: chunk,
    });
    for (const row of result.rows) {
      if (row.post_url) existing.add(row.post_url);
    }
  }

  return existing;
}

async function archiveTwitterPosts(source, posts = []) {
  const db = getDb();
  const withUrls = posts.filter((p) => p.postUrl);
  if (withUrls.length === 0) return { archived: 0, newPosts: [] };

  const existing = await getExistingArchivedPostUrlSet(withUrls.map((p) => p.postUrl));
  const newPosts = withUrls.filter((p) => !existing.has(p.postUrl));

  for (const post of newPosts) {
    await db.execute({
      sql: `
        INSERT OR IGNORE INTO tracker_archived_posts (
          source_id, source_type, source_name, influencer_handle,
          post_url, post_text, posted_at, paper_links, all_links, arxiv_ids
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        source.id || null,
        source.type || '',
        source.name || '',
        post.influencerHandle || '',
        post.postUrl,
        post.postText || '',
        post.postedAt || null,
        JSON.stringify(post.paperLinks || []),
        JSON.stringify(post.allLinks || []),
        JSON.stringify(post.arxivIds || []),
      ],
    });
  }

  return { archived: newPosts.length, newPosts };
}

function isSourceDue(lastCheckedAt, intervalHours) {
  if (!lastCheckedAt) return true;
  const lastMs = new Date(lastCheckedAt).getTime();
  if (Number.isNaN(lastMs)) return true;
  return Date.now() - lastMs >= intervalHours * 60 * 60 * 1000;
}

function mapArchivedTwitterPostsToPapers(posts = []) {
  const papers = [];
  const seenArxiv = new Set();

  for (const post of posts) {
    for (const arxivId of post.arxivIds || []) {
      if (!arxivId || seenArxiv.has(arxivId)) continue;
      seenArxiv.add(arxivId);
      papers.push({
        arxivId,
        title: post.postTextSnippet || post.postText || `arXiv:${arxivId}`,
        notes: post.postUrl
          ? `From ${post.influencerHandle ? `@${post.influencerHandle} ` : ''}tweet: ${post.postUrl}`
          : '',
      });
    }
  }

  return papers;
}

function safeParseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function getArchivedTwitterPosts({ sourceId, handle, limit = 100 } = {}) {
  const db = getDb();
  const constraints = [];
  const args = [];

  if (sourceId !== undefined && sourceId !== null && String(sourceId).trim() !== '') {
    constraints.push('source_id = ?');
    args.push(Number(sourceId));
  }
  if (handle) {
    constraints.push('influencer_handle = ?');
    args.push(String(handle).replace(/^@/, '').trim());
  }

  const parsedLimit = parseInt(limit, 10);
  const safeLimit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(parsedLimit, 500))
    : 100;
  args.push(safeLimit);

  const whereClause = constraints.length > 0 ? `WHERE ${constraints.join(' AND ')}` : '';
  const result = await db.execute({
    sql: `
      SELECT id, source_id, source_type, source_name, influencer_handle, post_url, post_text,
             posted_at, paper_links, all_links, arxiv_ids, crawled_at
      FROM tracker_archived_posts
      ${whereClause}
      ORDER BY COALESCE(posted_at, crawled_at) DESC
      LIMIT ?
    `,
    args,
  });

  return result.rows.map((row) => ({
    id: row.id,
    sourceId: row.source_id,
    sourceType: row.source_type,
    sourceName: row.source_name,
    influencerHandle: row.influencer_handle,
    postUrl: row.post_url,
    postText: row.post_text,
    postedAt: row.posted_at,
    paperLinks: safeParseJsonArray(row.paper_links),
    allLinks: safeParseJsonArray(row.all_links),
    arxivIds: safeParseJsonArray(row.arxiv_ids),
    crawledAt: row.crawled_at,
  }));
}

// ─── Paper Import ───────────────────────────────────────────────────────────

/**
 * Import a single arXiv paper (fetch metadata + PDF + upload to S3)
 * @param {string} arxivId
 * @param {string[]} tags - Tags to apply to the document
 * @param {string} notes - Notes to prepend
 * @returns {Promise<Object>} Created document
 */
async function importArxivPaper(arxivId, tags = [], notes = '') {
  console.log(`[PaperTracker] Importing arXiv:${arxivId}`);

  // Fetch metadata
  const metadata = await arxivService.fetchMetadata(arxivId);

  // Fetch PDF
  const pdfBuffer = await arxivService.fetchPdf(arxivId);

  // Upload to S3
  const filename = `arxiv_${arxivId.replace('/', '_')}_${metadata.title.slice(0, 30).replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const key = s3Service.generateS3Key(filename, DEFAULT_USER_ID);
  const { location } = await s3Service.uploadBuffer(pdfBuffer, key, 'application/pdf');

  // Try to find code repository URL
  let codeUrl = null;
  try {
    codeUrl = await arxivService.findCodeUrl(arxivId, metadata.abstract);
  } catch (_) {}

  // Build notes
  const fullNotes = [
    notes,
    `Authors: ${metadata.authors.join(', ')}`,
    `Category: ${metadata.primaryCategory}`,
    `Published: ${metadata.published}`,
    codeUrl ? `Code: ${codeUrl}` : '',
    '',
    `Abstract: ${metadata.abstract}`,
  ].filter(Boolean).join('\n');

  const document = await documentService.createDocument({
    title: metadata.title,
    type: 'paper',
    originalUrl: metadata.absUrl,
    s3Key: key,
    s3Url: location,
    fileSize: pdfBuffer.length,
    mimeType: 'application/pdf',
    tags,
    notes: fullNotes,
    userId: DEFAULT_USER_ID,
    analysisProvider: 'gemini-cli',
  });

  // Update with code URL if found
  if (codeUrl) {
    await documentService.updateDocument(document.id, { codeUrl, hasCode: true });
  }

  return document;
}

// ─── Run One Source ─────────────────────────────────────────────────────────

async function runSource(source) {
  let papers = [];
  let discoveredCount = 0;
  const sourceTag = `tracker:${source.type}`;
  let archived = 0;
  const sourceTimeoutMs = getSourceTimeoutMs(source.type, source.config || {});

  try {
    switch (source.type) {
      case 'hf':
        papers = await withTimeout(
          () => hfTracker.getNewPapers(source.config),
          sourceTimeoutMs,
          `${source.type}:${source.name || 'source'}`
        );
        discoveredCount = papers.length;
        break;
      case 'arxiv_authors': {
        const authors = Array.isArray(source.config?.authors) ? source.config.authors : [];
        const maxPerAuthor = Math.min(Math.max(1, parseInt(source.config?.maxPerAuthor || '5', 10)), 20);
        const lookbackDays = Math.min(Math.max(1, parseInt(source.config?.lookbackDays || '30', 10)), 90);
        const seen = new Set();
        const allPapers = [];
        for (const authorName of authors) {
          const name = String(authorName || '').trim();
          if (!name) continue;
          try {
            // eslint-disable-next-line no-await-in-loop
            const results = await withTimeout(
              () => arxivService.searchByAuthor(name, { maxResults: maxPerAuthor, lookbackDays }),
              sourceTimeoutMs,
              `arxiv_authors:${name}`
            );
            for (const paper of results) {
              if (!paper.arxivId || seen.has(paper.arxivId)) continue;
              seen.add(paper.arxivId);
              allPapers.push({
                ...paper,
                notes: `Author tracked: ${name}`,
              });
            }
          } catch (e) {
            console.warn(`[PaperTracker] arxiv_authors search failed for "${name}": ${e.message}`);
          }
        }
        papers = allPapers;
        discoveredCount = papers.length;
        break;
      }
      case 'twitter': {
        const mode = String(source.config?.mode || 'nitter').toLowerCase();
        if (mode === 'playwright') {
          const trackingMode = String(source.config?.trackingMode || 'paper').toLowerCase();
          const onlyWithModeMatches = source.config?.onlyWithModeMatches === true ||
            (trackingMode === 'paper' && source.config?.onlyWithPaperLinks === true);
          const rawInterval = parseInt(
            source.config?.crawlIntervalHours || DEFAULT_TWITTER_PLAYWRIGHT_INTERVAL_HOURS,
            10
          );
          const crawlIntervalHours = Number.isFinite(rawInterval)
            ? Math.max(1, Math.min(rawInterval, 24 * 14))
            : DEFAULT_TWITTER_PLAYWRIGHT_INTERVAL_HOURS;

          if (!isSourceDue(source.lastCheckedAt, crawlIntervalHours)) {
            console.log(
              `[PaperTracker] Source "${source.name}" skipped (next run every ${crawlIntervalHours}h)`
            );
            return { imported: 0, skipped: 0, failed: 0, archived: 0, checked: false };
          }

          const scrapeResult = await withTimeout(
            () => twitterPlaywrightTracker.extractLatestPosts({
              ...source.config,
              trackingMode,
              // Archive latest posts by default, not only mode-matching posts.
              onlyWithModeMatches,
              // Backward compatibility for paper mode.
              onlyWithPaperLinks: trackingMode === 'paper' ? onlyWithModeMatches : false,
            }),
            sourceTimeoutMs,
            `${source.type}:${source.name || 'source'}`
          );

          const archiveResult = await archiveTwitterPosts(source, scrapeResult.posts || []);
          archived = archiveResult.archived;
          if (trackingMode === 'paper') {
            papers = mapArchivedTwitterPostsToPapers(archiveResult.newPosts);
          } else {
            papers = [];
          }
          discoveredCount = papers.length;
          console.log(
            `[PaperTracker] Source "${source.name}" (${trackingMode} mode): ` +
            `archived ${archived} new post(s), mapped ${papers.length} arXiv candidate(s)`
          );
        } else {
          const rawPapers = await withTimeout(
            () => twitterTracker.getNewPapers(source.config),
            sourceTimeoutMs,
            `${source.type}:${source.name || 'source'}`
          );
          // Twitter tracker returns { arxivId, tweetUrl, tweetText }
          // — map to standard shape
          papers = rawPapers.map((p) => ({
            arxivId: p.arxivId,
            title: p.tweetText || `arXiv:${p.arxivId}`,
            notes: p.tweetUrl
              ? `From ${p.influencerHandle ? `@${p.influencerHandle} ` : ''}tweet: ${p.tweetUrl}`
              : '',
          }));
          discoveredCount = papers.length;
        }
        break;
      }
      case 'alphaxiv': {
        const raw = await withTimeout(
          () => alphaxivTracker.getNewPapers(source.config),
          sourceTimeoutMs,
          `${source.type}:${source.name || 'source'}`
        );
        papers = raw.map((p) => ({
          ...p,
          notes: p.views ? `AlphaXiv views: ${p.views}` : '',
        }));
        discoveredCount = papers.length;
        break;
      }
      case 'finance': {
        const raw = await withTimeout(
          () => financeTracker.getLatestItems(source.config),
          sourceTimeoutMs,
          `${source.type}:${source.name || 'source'}`
        );
        discoveredCount = raw.length;
        console.log(
          `[PaperTracker] Source "${source.name}" (finance): discovered ${discoveredCount} headline(s)`
        );
        break;
      }
      default:
        console.warn(`[PaperTracker] Unknown source type: ${source.type}`);
        return { imported: 0, skipped: 0, failed: 0, archived: 0, checked: false };
    }
  } catch (e) {
    console.error(`[PaperTracker] Source "${source.name}" (${source.type}) fetch failed: ${e.message}`);
    return { imported: 0, skipped: 0, failed: 1, archived: 0, error: e.message, checked: false };
  }

  if (source.type === 'finance') {
    console.log(`[PaperTracker] Source "${source.name}": found ${discoveredCount} item(s)`);
  } else {
    console.log(`[PaperTracker] Source "${source.name}": found ${papers.length} paper(s)`);
  }

  if (isDiscoveryOnlySource(source.type)) {
    console.log(
      `[PaperTracker] Source "${source.name}" (${source.type}) is discovery-only; ` +
      'skipping automatic import to library'
    );
    const discovered = source.type === 'finance' ? discoveredCount : papers.length;
    return {
      imported: 0,
      skipped: discovered,
      failed: 0,
      archived,
      checked: true,
      discoveryOnly: true,
      discovered,
    };
  }

  let imported = 0, skipped = 0, failed = 0;

  for (const paper of papers) {
    const { arxivId } = paper;
    if (!arxivId) { skipped++; continue; }

    try {
      if (await isAlreadySeen(arxivId)) {
        skipped++;
        continue;
      }

      const tags = [sourceTag];
      if (source.name && source.name !== source.type) {
        tags.push(`source:${source.name.toLowerCase().replace(/\s+/g, '-')}`);
      }

      await importArxivPaper(arxivId, tags, paper.notes || '');
      await markAsSeen(arxivId, source.type);
      imported++;
      console.log(`[PaperTracker] Imported arXiv:${arxivId} "${paper.title?.slice(0, 60)}"`);
    } catch (e) {
      console.error(`[PaperTracker] Failed to import arXiv:${arxivId}: ${e.message}`);
      // Still mark as seen to avoid retry loops on permanent failures
      await markAsSeen(arxivId, source.type).catch(() => {});
      failed++;
    }
  }

  return { imported, skipped, failed, archived, checked: true };
}

// ─── Main Run ───────────────────────────────────────────────────────────────

async function runAll() {
  if (_running) {
    console.log('[PaperTracker] Already running, skipping');
    return null;
  }

  _running = true;
  const startedAt = new Date().toISOString();
  const results = [];

  try {
    const sources = await getEnabledSources();
    console.log(`[PaperTracker] Running ${sources.length} enabled source(s)`);

    for (const source of sources) {
      const result = await runSource(source);
      results.push({ source: source.name, type: source.type, ...result });
      if (result?.checked !== false) {
        await markSourceChecked(source.id);
      }
    }
  } catch (e) {
    console.error('[PaperTracker] Unexpected error:', e.message);
  } finally {
    _running = false;
    _lastRunAt = startedAt;
    _lastRunResult = results;
  }

  const totalImported = results.reduce((s, r) => s + (r.imported || 0), 0);
  console.log(`[PaperTracker] Done — imported ${totalImported} new paper(s)`);
  return results;
}

async function runSourceAndMark(source) {
  const result = await runSource(source);
  if (result?.checked !== false) {
    await markSourceChecked(source.id);
  }
  return result;
}

// ─── Scheduler ─────────────────────────────────────────────────────────────

function start(intervalMs = DEFAULT_INTERVAL_MS) {
  if (_intervalHandle) return;

  console.log(`[PaperTracker] Scheduler started (every ${intervalMs / 3600000}h)`);

  // Run once shortly after startup, then on interval
  setTimeout(() => runAll().catch((e) => console.error('[PaperTracker] Startup run error:', e)), 30000);

  _intervalHandle = setInterval(
    () => runAll().catch((e) => console.error('[PaperTracker] Interval run error:', e)),
    intervalMs
  );
}

function stop() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
    console.log('[PaperTracker] Scheduler stopped');
  }
}

function getStatus() {
  return {
    running: _running,
    lastRunAt: _lastRunAt,
    lastRunResult: _lastRunResult,
    schedulerActive: !!_intervalHandle,
  };
}

module.exports = {
  // CRUD
  getSources,
  addSource,
  updateSource,
  deleteSource,
  // Operations
  runAll,
  runSource,
  runSourceAndMark,
  getArchivedTwitterPosts,
  getStatus,
  // Scheduler
  start,
  stop,
};
