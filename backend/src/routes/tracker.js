const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const os = require('os');
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const paperTracker = require('../services/paper-tracker.service');
const hfTracker = require('../services/hf-tracker.service');
const twitterTracker = require('../services/twitter-tracker.service');
const alphaxivTracker = require('../services/alphaxiv-tracker.service');
const twitterPlaywrightTracker = require('../services/twitter-playwright-tracker.service');
const financeTracker = require('../services/finance-tracker.service');
const arxivService = require('../services/arxiv.service');
const trackerProxy = require('../services/tracker-proxy.service');
const {
  extractTwitterHandle,
  normalizeTwitterProfileLinks,
} = require('../utils/twitter-profile-links');
const { getDb } = require('../db');

// ─── Feed cache (24h TTL, in-memory) ────────────────────────────────────────
const FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let feedCache = { data: [], fetchedAt: null, perSource: [] };
const FEED_SUPPORTED_SOURCE_TYPES = ['hf', 'twitter', 'arxiv_authors', 'alphaxiv', 'finance'];
const GENERIC_SOURCE_PRIORITY = { twitter: 5, arxiv_authors: 4, hf: 3, finance: 2, alphaxiv: 1, arxiv: 1 };
const FEED_SORT_SOURCE_PRIORITY = { twitter: 5, arxiv_authors: 4, hf: 3, finance: 2, alphaxiv: 1, arxiv: 1 };
const FEED_SOURCE_TIMEOUT_MS = parseInt(process.env.TRACKER_FEED_SOURCE_TIMEOUT_MS || '12000', 10);
const FEED_CACHE_MAX_ITEMS = Number.isFinite(Number(config.tracker?.feedCacheMaxItems))
  ? Math.max(1, Math.min(Number(config.tracker.feedCacheMaxItems), 20000))
  : 1000;
const FEED_METADATA_TIMEOUT_MS = parseInt(process.env.TRACKER_FEED_METADATA_TIMEOUT_MS || '4500', 10);
const FEED_METADATA_ENRICH_MAX = Number.isFinite(parseInt(process.env.TRACKER_FEED_METADATA_ENRICH_MAX || '80', 10))
  ? Math.max(0, Math.min(parseInt(process.env.TRACKER_FEED_METADATA_ENRICH_MAX || '80', 10), 500))
  : 80;
const FEED_REQUEST_TIMEOUT_MS = parseInt(process.env.TRACKER_FEED_REQUEST_TIMEOUT_MS || '10000', 10);
const FEED_PAGE_ANNOTATE_TIMEOUT_MS = parseInt(process.env.TRACKER_FEED_PAGE_ANNOTATE_TIMEOUT_MS || '4500', 10);
const FEED_PERSIST_ROW_ID = 1;
const FEED_PERSIST_MAX_STALE_MS = parseInt(
  process.env.TRACKER_FEED_PERSIST_MAX_STALE_MS || String(72 * 60 * 60 * 1000),
  10
);
const FEED_REFRESH_INTERVAL_MS = parseInt(
  process.env.TRACKER_FEED_REFRESH_INTERVAL_MS || String(24 * 60 * 60 * 1000),
  10
);
const FEED_REFRESH_STARTUP_DELAY_MS = parseInt(
  process.env.TRACKER_FEED_REFRESH_STARTUP_DELAY_MS || '45000',
  10
);
const TRACKER_STALE_RUN_TRIGGER_MS = (() => {
  const raw = parseInt(process.env.TRACKER_STALE_RUN_TRIGGER_MS || String(FEED_CACHE_TTL_MS), 10);
  if (!Number.isFinite(raw)) return FEED_CACHE_TTL_MS;
  return Math.max(60 * 60 * 1000, raw);
})();
const TRACKER_STALE_PROXY_RETRY_MS = (() => {
  const raw = parseInt(process.env.TRACKER_STALE_PROXY_RETRY_MS || String(10 * 60 * 1000), 10);
  if (!Number.isFinite(raw)) return 10 * 60 * 1000;
  return Math.max(30 * 1000, raw);
})();

let feedRefreshRunning = false;
let staleProxyTriggerInFlight = false;
let staleProxyLastAttemptAt = 0;

function getLastRunAgeMs(lastRunAt) {
  if (!lastRunAt) return Number.POSITIVE_INFINITY;
  const ms = new Date(lastRunAt).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Date.now() - ms;
}

function maybeTriggerStaleTrackerRun(reason = 'client_check') {
  if (config.tracker?.staleAutoRun === false) return false;
  if (!config.tracker?.enabled) return false;
  // In proxy-heavy mode we should not unexpectedly start local heavy jobs.
  if (config.tracker?.proxyHeavyOps) return false;

  const status = paperTracker.getStatus();
  if (status?.running) return false;

  const ageMs = getLastRunAgeMs(status?.lastRunAt);
  if (Number.isFinite(ageMs) && ageMs < TRACKER_STALE_RUN_TRIGGER_MS) {
    return false;
  }

  console.log(`[tracker] stale tracker run triggered (${reason}), ageMs=${Math.round(ageMs)}`);
  paperTracker.runAll().catch((error) => {
    console.error(`[tracker] stale tracker run failed (${reason}):`, error.message || error);
  });
  return true;
}

async function maybeTriggerStaleProxyRunFromStatus(proxyStatus, reason = 'status_request') {
  if (config.tracker?.staleAutoRun === false) return false;
  if (config.tracker?.staleProxyAutoRun === false) return false;
  if (!config.tracker?.proxyHeavyOps) return false;
  if (staleProxyTriggerInFlight) return false;

  const now = Date.now();
  if (Number.isFinite(staleProxyLastAttemptAt) && now - staleProxyLastAttemptAt < TRACKER_STALE_PROXY_RETRY_MS) {
    return false;
  }

  if (proxyStatus?.running) return false;

  const ageMs = getLastRunAgeMs(proxyStatus?.lastRunAt);
  if (Number.isFinite(ageMs) && ageMs < TRACKER_STALE_RUN_TRIGGER_MS) {
    return false;
  }

  staleProxyTriggerInFlight = true;
  staleProxyLastAttemptAt = now;
  try {
    await trackerProxy.runAll();
    console.log(`[tracker] stale proxy run triggered (${reason}), ageMs=${Math.round(ageMs)}`);
    return true;
  } catch (error) {
    console.warn(`[tracker] stale proxy run skipped (${reason}):`, error.message || error);
    return false;
  } finally {
    staleProxyTriggerInFlight = false;
  }
}

function normalizeStorageStatePath(rawPath) {
  return String(rawPath || '').trim();
}

function detectCrossOsPath(pathValue = '') {
  if (!pathValue) return false;
  if (process.platform === 'linux' && pathValue.startsWith('/Users/')) return true;
  if (process.platform === 'darwin' && pathValue.startsWith('/home/')) return true;
  if (process.platform === 'win32' && pathValue.startsWith('/')) return true;
  return false;
}

function getPlaywrightRuntimeStatus() {
  try {
    // Lazy-check runtime availability to avoid startup crash when Playwright is optional.
    // eslint-disable-next-line global-require
    const chromium = require('playwright').chromium;
    const executablePath = normalizeStorageStatePath(chromium.executablePath?.() || '');
    const chromiumExecutableExists = Boolean(executablePath) && fs.existsSync(executablePath);
    return {
      playwrightInstalled: true,
      chromiumExecutableExists,
      chromiumExecutablePath: executablePath || null,
    };
  } catch (error) {
    return {
      playwrightInstalled: false,
      chromiumExecutableExists: false,
      chromiumExecutablePath: null,
      playwrightError: error.message || String(error),
    };
  }
}

async function buildTwitterPlaywrightSetupStatus() {
  const requireAuthSession = process.env.X_PLAYWRIGHT_REQUIRE_SESSION !== 'false';
  const envStorageStatePath = normalizeStorageStatePath(process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH || '');
  const runtime = getPlaywrightRuntimeStatus();
  const sources = await paperTracker.getSources();

  const twitterPlaywrightSources = sources
    .filter((source) => String(source?.type || '').toLowerCase() === 'twitter')
    .filter((source) => String(source?.config?.mode || 'nitter').toLowerCase() === 'playwright');

  const sourceStatuses = twitterPlaywrightSources.map((source) => {
    const sourcePath = normalizeStorageStatePath(source?.config?.storageStatePath || envStorageStatePath);
    const sourcePathExists = sourcePath ? fs.existsSync(sourcePath) : false;
    return {
      id: source.id,
      name: source.name,
      storageStatePath: sourcePath || null,
      storageStatePathExists: sourcePathExists,
      usingEnvPath: !normalizeStorageStatePath(source?.config?.storageStatePath),
      pathLooksCrossOs: sourcePath ? detectCrossOsPath(sourcePath) : false,
    };
  });

  const issues = [];
  if (!runtime.playwrightInstalled) {
    issues.push('Playwright package is not installed on backend node.');
  } else if (!runtime.chromiumExecutableExists) {
    issues.push('Playwright Chromium executable is missing. Run: npx playwright install chromium');
  }

  if (requireAuthSession && sourceStatuses.length > 0) {
    const missingSession = sourceStatuses.some((source) => !source.storageStatePathExists);
    if (missingSession) {
      issues.push('One or more Twitter Playwright sources do not have a valid session file.');
    }
  }

  if (sourceStatuses.some((source) => source.pathLooksCrossOs)) {
    issues.push('Detected cross-OS session path (for example /Users/... on Linux).');
  }

  const ready = issues.length === 0;
  return {
    ready,
    requireAuthSession,
    platform: process.platform,
    envStorageStatePath: envStorageStatePath || null,
    envStorageStatePathExists: envStorageStatePath ? fs.existsSync(envStorageStatePath) : false,
    envPathLooksCrossOs: envStorageStatePath ? detectCrossOsPath(envStorageStatePath) : false,
    playwrightInstalled: runtime.playwrightInstalled,
    chromiumExecutableExists: runtime.chromiumExecutableExists,
    chromiumExecutablePath: runtime.chromiumExecutablePath,
    playwrightError: runtime.playwrightError || null,
    totalTwitterPlaywrightSources: sourceStatuses.length,
    sourceStatuses,
    issues,
    setupCommand: 'cd backend && npm run setup:x-session -- --out /home/<user>/.playwright/x-session.json',
  };
}

function normalizeArxivId(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/v\d+$/i, '');
}

function parsePostedAt(raw) {
  if (!raw) return '';
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

function getSourcePriority(type) {
  return GENERIC_SOURCE_PRIORITY[String(type || '').toLowerCase()] || 0;
}

function getFeedSortSourcePriority(type) {
  return FEED_SORT_SOURCE_PRIORITY[String(type || '').toLowerCase()] || 0;
}

function getBestFeedSortPriority(item = {}) {
  const sourceTypes = Array.isArray(item.sourceTypes) ? item.sourceTypes : [];
  const primaryType = String(item.sourceType || '').toLowerCase();
  const candidates = [...sourceTypes, primaryType].filter(Boolean);
  if (candidates.length === 0) return 0;
  return Math.max(...candidates.map((type) => getFeedSortSourcePriority(type)));
}

function normalizeTitle(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isLowSignalTitle(title) {
  const normalized = normalizeTitle(title).toLowerCase();
  if (!normalized) return true;
  if (/^arxiv[:\s]/i.test(normalized)) return true;
  if (normalized === 'paper' || normalized === 'papers') return true;
  if (normalized === 'new paper' || normalized === 'new papers') return true;
  if (normalized === 'paper:' || normalized === 'papers:') return true;
  return false;
}

function chooseBestTitle(primary, fallback, arxivId = '') {
  const a = normalizeTitle(primary);
  const b = normalizeTitle(fallback);
  if (a && !isLowSignalTitle(a)) return a;
  if (b && !isLowSignalTitle(b)) return b;
  if (a) return a;
  if (b) return b;
  return `arXiv:${arxivId}`;
}

function mergeSourcePaper(existing, incoming) {
  const names = new Set([
    ...(Array.isArray(existing.sourceNames) ? existing.sourceNames : []),
    ...(Array.isArray(incoming.sourceNames) ? incoming.sourceNames : []),
    existing.sourceName,
    incoming.sourceName,
  ].filter(Boolean));
  const types = new Set([
    ...(Array.isArray(existing.sourceTypes) ? existing.sourceTypes : []),
    ...(Array.isArray(incoming.sourceTypes) ? incoming.sourceTypes : []),
    String(existing.sourceType || '').toLowerCase(),
    String(incoming.sourceType || '').toLowerCase(),
  ].filter(Boolean));

  const titleA = normalizeTitle(existing.title);
  const titleB = normalizeTitle(incoming.title);

  const abstractA = String(existing.abstract || '');
  const abstractB = String(incoming.abstract || '');
  const betterAbstract = abstractA.length >= abstractB.length ? abstractA : abstractB;

  const authorsA = Array.isArray(existing.authors) ? existing.authors : [];
  const authorsB = Array.isArray(incoming.authors) ? incoming.authors : [];
  const betterAuthors = authorsA.length >= authorsB.length ? authorsA : authorsB;

  const sourceTypeA = String(existing.sourceType || '').toLowerCase();
  const sourceTypeB = String(incoming.sourceType || '').toLowerCase();
  const keepIncomingSource = getSourcePriority(sourceTypeB) >= getSourcePriority(sourceTypeA);

  return {
    ...existing,
    ...incoming,
    title: chooseBestTitle(titleA, titleB, existing.arxivId || incoming.arxivId),
    abstract: betterAbstract,
    authors: betterAuthors,
    publishedAt: existing.publishedAt || incoming.publishedAt || '',
    trackedDate: existing.trackedDate || incoming.trackedDate || '',
    sourceType: keepIncomingSource ? sourceTypeB : sourceTypeA,
    sourceName: keepIncomingSource ? (incoming.sourceName || existing.sourceName) : (existing.sourceName || incoming.sourceName),
    sourceNames: [...names],
    sourceTypes: [...types],
    upvotes: Math.max(Number(existing.upvotes || 0), Number(incoming.upvotes || 0)),
    views: Math.max(Number(existing.views || 0), Number(incoming.views || 0)),
    score: Math.max(Number(existing.score || 0), Number(incoming.score || 0)),
    saved: Boolean(existing.saved || incoming.saved),
  };
}

function mergeSourceFinanceItem(existing, incoming) {
  const names = new Set([
    ...(Array.isArray(existing.sourceNames) ? existing.sourceNames : []),
    ...(Array.isArray(incoming.sourceNames) ? incoming.sourceNames : []),
    existing.sourceName,
    incoming.sourceName,
  ].filter(Boolean));
  const types = new Set([
    ...(Array.isArray(existing.sourceTypes) ? existing.sourceTypes : []),
    ...(Array.isArray(incoming.sourceTypes) ? incoming.sourceTypes : []),
    String(existing.sourceType || '').toLowerCase(),
    String(incoming.sourceType || '').toLowerCase(),
  ].filter(Boolean));

  const sourceTypeA = String(existing.sourceType || '').toLowerCase();
  const sourceTypeB = String(incoming.sourceType || '').toLowerCase();
  const keepIncomingSource = getSourcePriority(sourceTypeB) >= getSourcePriority(sourceTypeA);

  const summaryA = String(existing.summary || existing.abstract || '');
  const summaryB = String(incoming.summary || incoming.abstract || '');

  return {
    ...existing,
    ...incoming,
    title: normalizeTitle(incoming.title) || normalizeTitle(existing.title) || 'Finance headline',
    summary: summaryA.length >= summaryB.length ? summaryA : summaryB,
    abstract: summaryA.length >= summaryB.length ? summaryA : summaryB,
    sourceType: keepIncomingSource ? sourceTypeB : sourceTypeA,
    sourceName: keepIncomingSource ? (incoming.sourceName || existing.sourceName) : (existing.sourceName || incoming.sourceName),
    sourceNames: [...names],
    sourceTypes: [...types],
    publishedAt: existing.publishedAt || incoming.publishedAt || '',
    trackedDate: existing.trackedDate || incoming.trackedDate || '',
  };
}

function buildFeedItemKey(item) {
  if (!item) return '';
  if (item.itemType === 'finance') {
    const external = String(item.externalId || item.url || '').trim();
    if (!external) return '';
    return `finance:${external}`;
  }
  const arxivId = normalizeArxivId(item.arxivId);
  if (!arxivId) return '';
  return `paper:${arxivId}`;
}

function mergeFeedItems(existing, incoming) {
  if (!existing) return incoming;
  if (existing.itemType === 'finance' || incoming.itemType === 'finance') {
    return mergeSourceFinanceItem(existing, incoming);
  }
  return mergeSourcePaper(existing, incoming);
}

function sortFeedPapers(items = []) {
  return [...items].sort((a, b) => {
    const sourcePriorityA = getBestFeedSortPriority(a);
    const sourcePriorityB = getBestFeedSortPriority(b);
    if (sourcePriorityB !== sourcePriorityA) return sourcePriorityB - sourcePriorityA;

    const timeA = new Date(a.trackedDate || a.publishedAt || 0).getTime() || 0;
    const timeB = new Date(b.trackedDate || b.publishedAt || 0).getTime() || 0;
    if (timeB !== timeA) return timeB - timeA;
    const scoreA = Number(a.score || 0) || 0;
    const scoreB = Number(b.score || 0) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function safeParseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    const parsed = JSON.parse(String(value));
    return parsed === undefined ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function normalizeFeedSnapshotData(items = []) {
  if (!Array.isArray(items)) return [];
  const normalized = items.map((item) => ({
    ...item,
    sourceTypes: Array.isArray(item?.sourceTypes) ? item.sourceTypes : [],
    sourceNames: Array.isArray(item?.sourceNames) ? item.sourceNames : [],
    authors: Array.isArray(item?.authors) ? item.authors : [],
    score: Number(item?.score || 0) || 0,
    upvotes: Number(item?.upvotes || 0) || 0,
    views: Number(item?.views || 0) || 0,
    saved: false,
  }));
  return sortFeedPapers(normalized).slice(0, FEED_CACHE_MAX_ITEMS);
}

async function loadPersistedFeedSnapshot() {
  const db = getDb();
  const result = await db.execute({
    sql: `
      SELECT fetched_at, data_json, per_source_json, source_count
      FROM tracker_feed_cache
      WHERE id = ?
      LIMIT 1
    `,
    args: [FEED_PERSIST_ROW_ID],
  });
  const row = result.rows?.[0];
  if (!row) return null;

  const fetchedMs = new Date(row.fetched_at || '').getTime();
  if (!Number.isFinite(fetchedMs)) return null;
  if (Date.now() - fetchedMs > FEED_PERSIST_MAX_STALE_MS) return null;

  const data = normalizeFeedSnapshotData(safeParseJson(row.data_json, []));
  if (data.length === 0) return null;

  return {
    data,
    fetchedAt: fetchedMs,
    perSource: safeParseJson(row.per_source_json, []),
    sourceCount: Number(row.source_count || 0) || 0,
  };
}

async function savePersistedFeedSnapshot({ data = [], perSource = [], sourceCount = 0, fetchedAtMs = Date.now() } = {}) {
  const db = getDb();
  const normalizedData = normalizeFeedSnapshotData(data);
  await db.execute({
    sql: `
      INSERT INTO tracker_feed_cache (id, fetched_at, data_json, per_source_json, source_count, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        fetched_at = excluded.fetched_at,
        data_json = excluded.data_json,
        per_source_json = excluded.per_source_json,
        source_count = excluded.source_count,
        updated_at = CURRENT_TIMESTAMP
    `,
    args: [
      FEED_PERSIST_ROW_ID,
      new Date(fetchedAtMs).toISOString(),
      JSON.stringify(normalizedData),
      JSON.stringify(Array.isArray(perSource) ? perSource : []),
      Number(sourceCount || 0) || 0,
    ],
  });
}

async function clearPersistedFeedSnapshot() {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM tracker_feed_cache WHERE id = ?`, args: [FEED_PERSIST_ROW_ID] });
}

async function annotateSavedStatus(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const db = getDb();
  const paperItems = items.filter((item) => item.itemType !== 'finance' && item.arxivId);
  if (paperItems.length === 0) {
    return items.map((item) => ({ ...item, saved: false }));
  }

  const likeClauses = paperItems.map(() => 'original_url LIKE ?').join(' OR ');
  const args = paperItems.map((item) => `%arxiv.org%${item.arxivId}%`);
  const result = await db.execute({
    sql: `SELECT original_url FROM documents WHERE ${likeClauses}`,
    args,
  });

  const savedIds = new Set();
  for (const row of result.rows || []) {
    const url = String(row.original_url || '');
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
    if (!match?.[1]) continue;
    savedIds.add(normalizeArxivId(match[1]));
  }

  return items.map((item) => {
    if (item.itemType === 'finance' || !item.arxivId) return { ...item, saved: false };
    return { ...item, saved: savedIds.has(normalizeArxivId(item.arxivId)) };
  });
}

function mapArchivedPostsToPapers(posts = [], source) {
  const results = [];
  const seen = new Set();
  const normalizedSourceType = String(source.type || '').toLowerCase();
  const sourceName = source.name || source.type;

  for (const post of posts) {
    const arxivIds = Array.isArray(post.arxivIds) ? post.arxivIds : [];
    for (const rawId of arxivIds) {
      const arxivId = normalizeArxivId(rawId);
      if (!arxivId || seen.has(arxivId)) continue;
      seen.add(arxivId);
      const influencer = post.influencerHandle ? `@${post.influencerHandle}` : '';
      results.push({
        itemType: 'paper',
        arxivId,
        title: chooseBestTitle(post.postTextSnippet, post.postText, arxivId),
        abstract: '',
        authors: [],
        publishedAt: post.postedAt || '',
        trackedDate: post.crawledAt || post.postedAt || '',
        sourceType: normalizedSourceType,
        sourceName,
        sourceTypes: [normalizedSourceType],
        sourceNames: [sourceName],
        score: 0,
        notes: post.postUrl
          ? `From ${influencer ? `${influencer} ` : ''}post: ${post.postUrl}`
          : '',
      });
    }
  }
  return results;
}

function normalizeFeedPaper(raw, source) {
  const arxivId = normalizeArxivId(raw?.arxivId);
  if (!arxivId) return null;
  const normalizedSourceType = String(source.type || '').toLowerCase();
  const sourceName = source.name || source.type;
  const score = Math.max(
    Number(raw?.score || 0) || 0,
    Number(raw?.upvotes || 0) || 0,
    Number(raw?.views || 0) || 0
  );

  return {
    itemType: 'paper',
    arxivId,
    title: chooseBestTitle(raw?.title, raw?.tweetText, arxivId),
    abstract: String(raw?.abstract || ''),
    authors: Array.isArray(raw?.authors) ? raw.authors : [],
    publishedAt: parsePostedAt(raw?.publishedAt),
    trackedDate: parsePostedAt(raw?.trackedDate || raw?.publishedAt),
    sourceType: normalizedSourceType,
    sourceName,
    sourceTypes: [normalizedSourceType],
    sourceNames: [sourceName],
    upvotes: Number(raw?.upvotes || 0) || 0,
    views: Number(raw?.views || 0) || 0,
    score,
    saved: false,
  };
}

function normalizeFeedFinanceItem(raw, source) {
  const externalId = String(raw?.externalId || raw?.url || '').trim();
  if (!externalId) return null;
  const normalizedSourceType = String(source.type || '').toLowerCase();
  const sourceName = source.name || source.type;
  const summary = String(raw?.summary || '').trim();

  return {
    itemType: 'finance',
    externalId,
    symbol: String(raw?.symbol || '').toUpperCase(),
    title: normalizeTitle(raw?.title) || 'Finance headline',
    abstract: summary,
    summary,
    url: String(raw?.url || '').trim(),
    authors: [],
    publishedAt: parsePostedAt(raw?.publishedAt),
    trackedDate: parsePostedAt(raw?.trackedDate || raw?.publishedAt),
    sourceType: normalizedSourceType,
    sourceName,
    sourceTypes: [normalizedSourceType],
    sourceNames: [sourceName],
    score: Number(raw?.score || 0) || 0,
    saved: false,
  };
}

function needsArxivEnrichment(item) {
  if (!item?.arxivId) return false;
  const weakTitle = isLowSignalTitle(item.title);
  const weakAbstract = String(item.abstract || '').trim().length < 60;
  const noAuthors = !Array.isArray(item.authors) || item.authors.length === 0;
  return weakTitle || (weakAbstract && noAuthors);
}

async function withTimeout(task, timeoutMs, label) {
  const safeMs = Number.isFinite(timeoutMs) ? Math.max(500, Math.min(timeoutMs, 15000)) : 4500;
  let timeoutHandle = null;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`${label}_timeout_${safeMs}ms`)), safeMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function isTimeoutError(error) {
  const text = String(error?.message || '').toLowerCase();
  return error?.name === 'AbortError'
    || text.includes('timeout')
    || text.includes('timed out')
    || text.includes('source_timeout');
}

async function enrichFeedWithArxivMetadata(items = []) {
  if (!Array.isArray(items) || items.length === 0 || FEED_METADATA_ENRICH_MAX <= 0) return items;

  const enriched = [...items];
  const candidates = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => needsArxivEnrichment(item))
    .slice(0, FEED_METADATA_ENRICH_MAX);

  if (candidates.length === 0) return enriched;

  const concurrency = Math.min(4, candidates.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const current = candidates[cursor++];
      const { item, idx } = current;
      try {
        // eslint-disable-next-line no-await-in-loop
        const meta = await withTimeout(
          () => arxivService.fetchMetadata(item.arxivId),
          FEED_METADATA_TIMEOUT_MS,
          'arxiv_metadata'
        );
        const next = { ...enriched[idx] };
        next.title = chooseBestTitle(next.title, meta?.title, item.arxivId);
        if (String(next.abstract || '').trim().length < 60 && meta?.abstract) {
          next.abstract = String(meta.abstract).trim();
        }
        if ((!Array.isArray(next.authors) || next.authors.length === 0) && Array.isArray(meta?.authors)) {
          next.authors = meta.authors;
        }
        if (!next.publishedAt && meta?.published) {
          next.publishedAt = parsePostedAt(meta.published);
        }
        enriched[idx] = next;
      } catch (_) {
        // Keep original feed item when metadata enrichment fails/times out.
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return enriched;
}

function applySourceFilters(items, config) {
  const keywords = String(config.keywords || '')
    .split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const watchedAuthors = String(config.watchedAuthors || '')
    .split(/\n+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (keywords.length === 0 && watchedAuthors.length === 0) return items;
  return items.filter((item) => {
    const titleAbstract = `${item.title || ''} ${item.abstract || ''}`.toLowerCase();
    if (keywords.length > 0 && keywords.some((kw) => titleAbstract.includes(kw))) return true;
    const authorText = (item.authors || []).join(' ').toLowerCase();
    if (watchedAuthors.length > 0 && watchedAuthors.some((wa) => authorText.includes(wa))) return true;
    return false;
  });
}

async function fetchSourceFeedPapers(source, { debug = false } = {}) {
  const sourceType = String(source.type || '').toLowerCase();
  const sourceName = source.name || source.type;
  const withTimeout = async (task) => {
    const timeoutMs = Number.isFinite(FEED_SOURCE_TIMEOUT_MS)
      ? Math.max(3000, Math.min(FEED_SOURCE_TIMEOUT_MS, 45000))
      : 12000;
    let timeoutHandle = null;
    try {
      return await Promise.race([
        task(),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error(`source_timeout_${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  };
  try {
    let items = [];
    if (sourceType === 'hf') {
      const raw = await withTimeout(() => hfTracker.getNewPapers(source.config || {}));
      items = raw.map((item) => normalizeFeedPaper(item, source)).filter(Boolean);
    }
    else if (sourceType === 'alphaxiv') {
      const raw = await withTimeout(() => alphaxivTracker.getNewPapers(source.config || {}));
      items = raw.map((item) => normalizeFeedPaper(item, source)).filter(Boolean);
    }
    else if (sourceType === 'arxiv_authors') {
      const authors = Array.isArray(source.config?.authors) ? source.config.authors : [];
      const maxPerAuthor = Math.min(Math.max(1, parseInt(source.config?.maxPerAuthor || '5', 10)), 20);
      const lookbackDays = Math.min(Math.max(1, parseInt(source.config?.lookbackDays || '30', 10)), 90);
      const seen = new Set();
      for (const authorName of authors) {
        const name = String(authorName || '').trim();
        if (!name) continue;
        try {
          // eslint-disable-next-line no-await-in-loop
          const results = await arxivService.searchByAuthor(name, { maxResults: maxPerAuthor, lookbackDays });
          for (const paper of results) {
            if (!paper.arxivId || seen.has(paper.arxivId)) continue;
            seen.add(paper.arxivId);
            items.push(normalizeFeedPaper(paper, source));
          }
        } catch (_) { /* skip author on error */ }
      }
      items = items.filter(Boolean);
    }
    else if (sourceType === 'twitter') {
      const mode = String(source.config?.mode || 'nitter').toLowerCase();
      if (mode === 'playwright') {
        // Feed endpoint should stay lightweight. Reuse archived posts by default.
        const archivedPosts = await paperTracker.getArchivedTwitterPosts({
          sourceId: source.id,
          limit: 300,
        });
        items = mapArchivedPostsToPapers(archivedPosts, source);
        // Debug mode can perform a live scrape when there is no archive yet.
        if (debug && items.length === 0) {
          const raw = await withTimeout(() => twitterPlaywrightTracker.getNewPapers(source.config || {}));
          items = raw.map((item) => normalizeFeedPaper(item, source)).filter(Boolean);
        }
      } else {
        const raw = await withTimeout(() => twitterTracker.getNewPapers(source.config || {}));
        items = raw.map((item) => normalizeFeedPaper(item, source)).filter(Boolean);
      }
    }
    else if (sourceType === 'finance') {
      const raw = await withTimeout(() => financeTracker.getLatestItems(source.config || {}));
      items = raw.map((item) => normalizeFeedFinanceItem(item, source)).filter(Boolean);
    }
    else {
      return { source: sourceName, type: sourceType, total: 0, skipped: true, reason: 'unsupported_source_type' };
    }

    items = applySourceFilters(items, source.config || {});

    return {
      source: sourceName,
      type: sourceType,
      total: items.length,
      skipped: false,
      items,
    };
  } catch (error) {
    return {
      source: sourceName,
      type: sourceType,
      total: 0,
      skipped: true,
      reason: error.message || 'fetch_failed',
      items: [],
    };
  }
}

async function buildFeedSnapshot({ debug = false } = {}) {
  const allSources = await paperTracker.getSources();
  const enabledSources = allSources.filter((source) =>
    source.enabled && FEED_SUPPORTED_SOURCE_TYPES.includes(String(source.type || '').toLowerCase())
  );

  const sourceRuns = [];
  for (const source of enabledSources) {
    // Keep predictable external request behavior and avoid hammering external APIs.
    // eslint-disable-next-line no-await-in-loop
    const result = await fetchSourceFeedPapers(source, { debug });
    sourceRuns.push(result);
  }

  const mergedByFeedKey = new Map();
  for (const run of sourceRuns) {
    const sourceItems = Array.isArray(run.items) ? run.items : [];
    for (const item of sourceItems) {
      const key = buildFeedItemKey(item);
      if (!key) continue;
      const existing = mergedByFeedKey.get(key);
      if (!existing) mergedByFeedKey.set(key, item);
      else mergedByFeedKey.set(key, mergeFeedItems(existing, item));
    }
  }

  const items = sortFeedPapers([...mergedByFeedKey.values()]);
  const enrichedItems = await enrichFeedWithArxivMetadata(items);
  const cappedItems = enrichedItems.slice(0, FEED_CACHE_MAX_ITEMS);
  if (enrichedItems.length > cappedItems.length) {
    console.log(
      `[tracker] feed cache cap applied: ${enrichedItems.length} -> ${cappedItems.length} (oldest trimmed)`
    );
  }

  const perSource = sourceRuns.map((run) => ({
    source: run.source,
    type: run.type,
    total: run.total || 0,
    skipped: run.skipped || false,
    reason: run.reason || null,
  }));

  const fetchedAtMs = Date.now();
  return {
    data: normalizeFeedSnapshotData(cappedItems),
    fetchedAt: fetchedAtMs,
    perSource,
    sourceCount: enabledSources.length,
  };
}

async function refreshFeedSnapshot(reason = 'manual', { debug = false } = {}) {
  if (feedRefreshRunning) return null;
  feedRefreshRunning = true;
  try {
    const snapshot = await buildFeedSnapshot({ debug });
    feedCache = {
      data: snapshot.data,
      fetchedAt: snapshot.fetchedAt,
      perSource: snapshot.perSource,
      sourceCount: snapshot.sourceCount,
    };
    await savePersistedFeedSnapshot({
      data: snapshot.data,
      perSource: snapshot.perSource,
      sourceCount: snapshot.sourceCount,
      fetchedAtMs: snapshot.fetchedAt,
    });
    console.log(`[tracker] feed snapshot refreshed (${reason}), items=${snapshot.data.length}`);
    return snapshot;
  } catch (error) {
    console.error(`[tracker] feed snapshot refresh failed (${reason}):`, error.message || error);
    throw error;
  } finally {
    feedRefreshRunning = false;
  }
}

function startFeedRefreshScheduler() {
  if (!config.tracker?.enabled) return;
  if (globalThis.__AUTO_RESEARCHER_FEED_REFRESH_STARTED__) return;
  globalThis.__AUTO_RESEARCHER_FEED_REFRESH_STARTED__ = true;

  const startupDelay = Number.isFinite(FEED_REFRESH_STARTUP_DELAY_MS)
    ? Math.max(2000, FEED_REFRESH_STARTUP_DELAY_MS)
    : 45000;
  const intervalMs = Number.isFinite(FEED_REFRESH_INTERVAL_MS)
    ? Math.max(60 * 60 * 1000, FEED_REFRESH_INTERVAL_MS)
    : 24 * 60 * 60 * 1000;

  setTimeout(() => {
    refreshFeedSnapshot('startup').catch(() => {});
  }, startupDelay);

  setInterval(() => {
    refreshFeedSnapshot('scheduled').catch(() => {});
  }, intervalMs);

  console.log(`[tracker] feed refresh scheduler enabled (every ${Math.round(intervalMs / 3600000)}h)`);
}

startFeedRefreshScheduler();

// GET /api/tracker/feed — latest papers from enabled sources (cached 24h)
// ?debug=1 bypasses cache  ?offset=N ?limit=N (default 5)
router.get('/feed', async (req, res) => {
  try {
    const debug = req.query.debug === '1';
    const shuffleRequested = req.query.shuffle === '1';
    const staleRunTriggered = !debug ? maybeTriggerStaleTrackerRun('feed_request') : false;
    const parsedLimit = parseInt(req.query.limit || '5', 10);
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 5;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const now = Date.now();
    let snapshot = null;
    let cacheSource = 'live';

    if (!debug && Array.isArray(feedCache.data) && feedCache.data.length > 0 && feedCache.fetchedAt) {
      const cacheAge = now - Number(feedCache.fetchedAt);
      if (Number.isFinite(cacheAge) && cacheAge < FEED_CACHE_TTL_MS) {
        snapshot = {
          data: normalizeFeedSnapshotData(feedCache.data),
          fetchedAt: Number(feedCache.fetchedAt),
          perSource: Array.isArray(feedCache.perSource) ? feedCache.perSource : [],
          sourceCount: Number(feedCache.sourceCount || 0) || 0,
        };
        cacheSource = 'memory';
      }
    }

    if (!snapshot && !debug) {
      const persisted = await withTimeout(
        () => loadPersistedFeedSnapshot(),
        FEED_REQUEST_TIMEOUT_MS,
        'feed_persisted_load'
      ).catch(() => null);
      if (persisted?.data?.length) {
        snapshot = persisted;
        cacheSource = 'persisted';
        feedCache = {
          data: persisted.data,
          fetchedAt: persisted.fetchedAt,
          perSource: persisted.perSource || [],
          sourceCount: persisted.sourceCount || 0,
        };
        const persistedAge = now - persisted.fetchedAt;
        if (config.tracker?.enabled && persistedAge >= FEED_CACHE_TTL_MS && !feedRefreshRunning) {
          refreshFeedSnapshot('stale_persisted').catch(() => {});
        }
      }
    }

    if (!snapshot) {
      if (!debug) {
        if (!feedRefreshRunning) {
          refreshFeedSnapshot('http_warmup').catch(() => {});
        }
        return res.json({
          data: [],
          cached: false,
          cacheSource: 'warming',
          fetchedAt: null,
          offset,
          limit,
          hasMore: false,
          total: 0,
          perSource: [],
          sourceCount: 0,
          refreshInProgress: true,
          staleRunTriggered,
          warming: true,
          message: 'Tracker feed is warming up. Please retry in a few seconds.',
        });
      }
      try {
        const liveSnapshot = await refreshFeedSnapshot('http_debug', { debug: true });
        if (!liveSnapshot) throw new Error('feed_refresh_busy');
        snapshot = liveSnapshot;
        cacheSource = 'live';
      } catch (liveError) {
        const persistedFallback = await loadPersistedFeedSnapshot();
        if (persistedFallback?.data?.length) {
          snapshot = persistedFallback;
          cacheSource = 'persisted-fallback';
          feedCache = {
            data: persistedFallback.data,
            fetchedAt: persistedFallback.fetchedAt,
            perSource: persistedFallback.perSource || [],
            sourceCount: persistedFallback.sourceCount || 0,
          };
        } else {
          throw liveError;
        }
      }
    }

    let sourceData = Array.isArray(snapshot.data) ? snapshot.data : [];
    let shuffled = false;

    // On refresh: always push saved papers to the end.
    // Within each group (unsaved / saved), add random noise with 30% probability.
    if (shuffleRequested && offset === 0) {
      try {
        const annotatedAll = await withTimeout(
          () => annotateSavedStatus(sourceData),
          FEED_PAGE_ANNOTATE_TIMEOUT_MS * 3,
          'feed_saved_status_shuffle'
        );
        const addNoise = Math.random() < 0.3;
        const unsaved = annotatedAll.filter((item) => !item.saved);
        const saved = annotatedAll.filter((item) => item.saved);
        if (addNoise) {
          unsaved.sort(() => Math.random() - 0.5);
          saved.sort(() => Math.random() - 0.5);
        }
        sourceData = [...unsaved, ...saved];
        shuffled = saved.length > 0 || addNoise;
      } catch (shuffleError) {
        console.warn('[tracker] shuffle annotation failed, using default order:', shuffleError.message || shuffleError);
      }
    }

    const rawPageData = sourceData.slice(offset, offset + limit);
    let pageData = [];
    if (shuffled) {
      // Already annotated during shuffle — no need to re-annotate the page
      pageData = rawPageData;
    } else {
      try {
        pageData = await withTimeout(
          () => annotateSavedStatus(rawPageData),
          FEED_PAGE_ANNOTATE_TIMEOUT_MS,
          'feed_saved_status'
        );
      } catch (annotateError) {
        console.warn('[tracker] annotateSavedStatus timed out/faulted:', annotateError.message || annotateError);
        pageData = rawPageData.map((item) => ({ ...item, saved: Boolean(item?.saved) }));
      }
    }

    const fetchedAtIso = snapshot.fetchedAt
      ? new Date(snapshot.fetchedAt).toISOString()
      : new Date(now).toISOString();

    res.json({
      data: pageData,
      cached: cacheSource !== 'live' && !debug,
      cacheSource,
      fetchedAt: fetchedAtIso,
      offset,
      limit,
      hasMore: offset + rawPageData.length < sourceData.length,
      total: sourceData.length,
      perSource: Array.isArray(snapshot.perSource) ? snapshot.perSource : [],
      sourceCount: Number(snapshot.sourceCount || 0) || 0,
      refreshInProgress: feedRefreshRunning,
      staleRunTriggered,
      shuffled,
    });
  } catch (e) {
    console.error('[tracker] GET /feed error:', e);
    const timeout = isTimeoutError(e);
    res.status(timeout ? 504 : 500).json({
      error: timeout ? 'Tracker feed request timed out. Please retry.' : (e.message || 'Failed to load tracker feed'),
      code: timeout ? 'TRACKER_FEED_TIMEOUT' : 'TRACKER_FEED_ERROR',
    });
  }
});

// POST /api/tracker/feed/invalidate — force feed cache refresh (auth required)
router.post('/feed/invalidate', requireAuth, (req, res) => {
  (async () => {
    feedCache = { data: [], fetchedAt: null, perSource: [], sourceCount: 0 };
    await clearPersistedFeedSnapshot();
    if (config.tracker?.enabled) {
      refreshFeedSnapshot('invalidate').catch(() => {});
    }
  })()
    .then(() => res.json({ ok: true }))
    .catch((error) => res.status(500).json({ error: error.message || 'Failed to invalidate feed cache' }));
});

// GET /api/tracker/sources — list all sources
router.get('/sources', async (req, res) => {
  try {
    const sources = await paperTracker.getSources();
    // Redact sensitive config fields for non-auth callers.
    // Scholar credentials are env-managed and never returned from API responses.
    const authHeader = req.headers.authorization;
    const isAuth = !!authHeader;
    const safeSources = sources.map((s) => sanitizeSourceForResponse(s, isAuth));
    res.json(safeSources);
  } catch (e) {
    console.error('[tracker] GET /sources error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tracker/sources — add a new source
router.post('/sources', requireAuth, async (req, res) => {
  try {
    const { type, name, config } = req.body;
    if (!type || !name) {
      return res.status(400).json({ error: 'type and name are required' });
    }
    const normalizedType = String(type || '').toLowerCase();
    const validTypes = FEED_SUPPORTED_SOURCE_TYPES;
    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
    const normalizedConfig = normalizeSourceConfig(normalizedType, config || {});
    const id = await paperTracker.addSource(normalizedType, name, normalizedConfig);
    res.status(201).json({ id, type: normalizedType, name, config: normalizedConfig, enabled: true });
  } catch (e) {
    console.error('[tracker] POST /sources error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/tracker/sources/:id — update a source
router.put('/sources/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, config, enabled, type } = req.body;
    let normalizedConfig = undefined;
    if (config !== undefined) {
      let sourceType = type;
      if (!sourceType) {
        const sources = await paperTracker.getSources();
        const source = sources.find((s) => s.id === Number(id));
        sourceType = source?.type;
      }
      if (!sourceType) {
        return res.status(404).json({ error: 'Source not found' });
      }
      normalizedConfig = normalizeSourceConfig(String(sourceType || '').toLowerCase(), config);
    }
    await paperTracker.updateSource(Number(id), { name, config: normalizedConfig, enabled });
    res.json({ ok: true });
  } catch (e) {
    console.error('[tracker] PUT /sources/:id error:', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/tracker/sources/:id — delete a source
router.delete('/sources/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await paperTracker.deleteSource(Number(id));
    res.json({ ok: true });
  } catch (e) {
    console.error('[tracker] DELETE /sources/:id error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tracker/run — manually trigger a full run
router.post('/run', requireAuth, async (req, res) => {
  try {
    if (config.tracker?.proxyHeavyOps) {
      try {
        await trackerProxy.runAll();
        return res.json({ ok: true, message: 'Tracker run started on desktop via FRP', proxied: true });
      } catch (proxyError) {
        if (config.tracker?.proxyStrict) {
          return res.status(503).json({
            error: `Desktop tracker service is not available: ${proxyError.message || 'proxy unavailable'}`,
            code: 'TRACKER_PROXY_UNAVAILABLE',
            proxied: true,
          });
        }
        console.warn('[tracker] proxy run failed, falling back to local:', proxyError.message);
      }
    }
    // Fire and forget; don't await the whole run
    paperTracker.runAll().catch((e) => console.error('[tracker] Manual run error:', e));
    res.json({ ok: true, message: 'Tracker run started in background', proxied: false });
  } catch (e) {
    console.error('[tracker] POST /run error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tracker/sources/:id/run — run a single source
router.post('/sources/:id/run', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (config.tracker?.proxyHeavyOps) {
      try {
        await trackerProxy.runSource(Number(id));
        return res.json({ ok: true, message: `Source ${id} run started on desktop via FRP`, proxied: true });
      } catch (proxyError) {
        if (config.tracker?.proxyStrict) {
          return res.status(503).json({
            error: `Desktop tracker service is not available: ${proxyError.message || 'proxy unavailable'}`,
            code: 'TRACKER_PROXY_UNAVAILABLE',
            proxied: true,
          });
        }
        console.warn(`[tracker] proxy source run failed for ${id}, falling back to local:`, proxyError.message);
      }
    }

    const sources = await paperTracker.getSources();
    const source = sources.find((s) => s.id === Number(id));
    if (!source) return res.status(404).json({ error: 'Source not found' });

    paperTracker.runSourceAndMark(source).catch((e) =>
      console.error(`[tracker] Source ${id} run error:`, e)
    );
    res.json({ ok: true, message: `Source "${source.name}" run started in background` });
  } catch (e) {
    console.error('[tracker] POST /sources/:id/run error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tracker/status — get last run status
router.get('/status', async (req, res) => {
  if (config.tracker?.proxyHeavyOps) {
    try {
      const status = await trackerProxy.getStatus();
      const staleRunTriggered = await maybeTriggerStaleProxyRunFromStatus(status, 'status_request');
      return res.json({ ...status, proxied: true, staleRunTriggered });
    } catch (e) {
      if (config.tracker?.proxyStrict) {
        return res.status(503).json({
          error: `Desktop tracker service is not available: ${e.message || 'proxy unavailable'}`,
          code: 'TRACKER_PROXY_UNAVAILABLE',
          proxied: true,
          staleRunTriggered: false,
        });
      }
      console.warn('[tracker] proxy status failed, falling back to local:', e.message);
    }
  }
  const staleRunTriggered = maybeTriggerStaleTrackerRun('status_request');
  return res.json({ ...paperTracker.getStatus(), proxied: false, staleRunTriggered });
});

// GET /api/tracker/twitter/posts — recently archived twitter/x posts
router.get('/twitter/posts', requireAuth, async (req, res) => {
  try {
    const posts = await paperTracker.getArchivedTwitterPosts({
      sourceId: req.query.sourceId,
      handle: req.query.handle,
      limit: req.query.limit || 100,
    });
    res.json({ data: posts, total: posts.length });
  } catch (e) {
    console.error('[tracker] GET /twitter/posts error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/tracker/twitter/playwright/setup-status — runtime + credential readiness (auth required)
router.get('/twitter/playwright/setup-status', requireAuth, async (req, res) => {
  try {
    const status = await buildTwitterPlaywrightSetupStatus();
    res.json(status);
  } catch (e) {
    console.error('[tracker] GET /twitter/playwright/setup-status error:', e);
    res.status(500).json({ error: e.message || 'Failed to inspect twitter playwright setup' });
  }
});

// POST /api/tracker/twitter/playwright/session-upload — upload a Playwright session file from client
router.post('/twitter/playwright/session-upload', requireAuth, async (req, res) => {
  try {
    const sessionJson = req.body?.sessionJson;
    if (!sessionJson || typeof sessionJson !== 'object' || Array.isArray(sessionJson)) {
      return res.status(400).json({ error: 'sessionJson must be a JSON object' });
    }
    if (!Array.isArray(sessionJson.cookies) && !Array.isArray(sessionJson.origins)) {
      return res.status(400).json({ error: 'Invalid Playwright session: expected cookies or origins array' });
    }
    const targetDir = path.join(os.homedir(), '.playwright');
    const targetPath = path.join(targetDir, 'x-session.json');
    await fsPromises.mkdir(targetDir, { recursive: true });
    await fsPromises.writeFile(targetPath, JSON.stringify(sessionJson, null, 2), 'utf8');
    const stat = await fsPromises.stat(targetPath);
    return res.json({ path: targetPath, size: stat.size });
  } catch (e) {
    console.error('[tracker] POST /twitter/playwright/session-upload error:', e);
    return res.status(500).json({ error: e.message || 'Failed to save session file' });
  }
});

// POST /api/tracker/twitter/playwright/preview — scrape latest paper posts (auth required)
router.post('/twitter/playwright/preview', requireAuth, async (req, res) => {
  try {
    const normalizedConfig = normalizeTwitterConfig({
      mode: 'playwright',
      ...req.body,
    });
    if (config.tracker?.proxyHeavyOps) {
      try {
        const result = await trackerProxy.previewTwitter(normalizedConfig);
        return res.json({ ...result, proxied: true });
      } catch (proxyError) {
        if (config.tracker?.proxyStrict) {
          return res.status(503).json({
            error: `Desktop tracker service is not available: ${proxyError.message || 'proxy unavailable'}`,
            code: 'TRACKER_PROXY_UNAVAILABLE',
            proxied: true,
          });
        }
        console.warn('[tracker] proxy twitter preview failed, falling back to local:', proxyError.message);
      }
    }
    const result = await twitterPlaywrightTracker.extractLatestPosts(normalizedConfig);
    return res.json({ ...result, proxied: false });
  } catch (e) {
    console.error('[tracker] POST /twitter/playwright/preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function redactConfig(config) {
  if (!config) return {};
  const safe = { ...config };
  if (safe.password) safe.password = '***';
  if (safe.apiKey) safe.apiKey = '***';
  return safe;
}

function sanitizeSourceForResponse(source, isAuth) {
  return {
    ...source,
    config: isAuth ? (source?.config || {}) : redactConfig(source?.config || {}),
  };
}

function normalizeSourceConfig(type, config) {
  if (type === 'twitter') return normalizeTwitterConfig(config);
  if (type === 'finance') return normalizeFinanceConfig(config);
  if (type === 'arxiv_authors') return normalizeArxivAuthorsConfig(config);
  return config || {};
}

function normalizeArxivAuthorsConfig(config = {}) {
  const authors = Array.isArray(config.authors)
    ? config.authors.map((a) => String(a || '').trim()).filter(Boolean)
    : [];
  const maxPerAuthorRaw = parseInt(config.maxPerAuthor || '5', 10);
  const lookbackDaysRaw = parseInt(config.lookbackDays || '30', 10);
  return {
    authors,
    maxPerAuthor: Number.isFinite(maxPerAuthorRaw) ? Math.max(1, Math.min(maxPerAuthorRaw, 20)) : 5,
    lookbackDays: Number.isFinite(lookbackDaysRaw) ? Math.max(1, Math.min(lookbackDaysRaw, 90)) : 30,
  };
}

function normalizeTwitterConfig(config = {}) {
  const mode = String(config.mode || 'nitter').toLowerCase();
  if (!['nitter', 'playwright'].includes(mode)) {
    throw new Error('Twitter source mode must be "nitter" or "playwright"');
  }

  if (mode === 'playwright') {
    const trackingMode = String(config.trackingMode || config.topicMode || 'paper').toLowerCase();
    const supportedModes = twitterPlaywrightTracker.SUPPORTED_TRACKING_MODES || ['paper'];
    if (!supportedModes.includes(trackingMode)) {
      throw new Error(`Twitter tracking mode must be one of: ${supportedModes.join(', ')}`);
    }

    const { normalized: profileLinks, invalid } = normalizeTwitterProfileLinks(
      config.profileLinks || config.profileLinksText || config.links || []
    );

    if (invalid.length > 0) {
      throw new Error(`Invalid Twitter profile link(s): ${invalid.join(', ')}`);
    }
    if (profileLinks.length === 0) {
      throw new Error('Playwright mode requires at least one Twitter profile link');
    }

    const maxRaw = parseInt(config.maxPostsPerProfile || '15', 10);
    const maxPostsPerProfile = Number.isFinite(maxRaw)
      ? Math.max(1, Math.min(maxRaw, 50))
      : 15;
    const intervalRaw = parseInt(config.crawlIntervalHours || '24', 10);
    const crawlIntervalHours = Number.isFinite(intervalRaw)
      ? Math.max(1, Math.min(intervalRaw, 24 * 14))
      : 24;
    const onlyWithModeMatches = config.onlyWithModeMatches === true ||
      (trackingMode === 'paper' && config.onlyWithPaperLinks === true);

    return {
      mode,
      trackingMode,
      profileLinks,
      maxPostsPerProfile,
      // Generic filter switch (future modes can reuse this); preserve legacy flag too.
      onlyWithModeMatches,
      onlyWithPaperLinks: trackingMode === 'paper' ? onlyWithModeMatches : false,
      crawlIntervalHours,
      storageStatePath: config.storageStatePath || process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH || '',
      headless: config.headless !== false,
    };
  }

  const usernameFromLink = extractTwitterHandle(
    (config.profileLinks && config.profileLinks[0]) || config.profileLink
  );
  const username = extractTwitterHandle(config.username || usernameFromLink || '');
  if (!username) {
    throw new Error('Nitter mode requires a valid Twitter username or profile link');
  }

  return {
    mode,
    username,
    nitterInstance: config.nitterInstance || '',
  };
}

function normalizeFinanceConfig(config = {}) {
  return financeTracker.normalizeConfig(config);
}

// POST /api/tracker/parse-author-names — use Claude to parse a free-text list of scholar names
// Returns: { authors: string[] }
router.post('/parse-author-names', requireAuth, async (req, res) => {
  try {
    const rawText = String(req.body?.text || '').trim();
    if (!rawText) return res.status(400).json({ error: 'text is required' });

    // Simple heuristic fallback: split by newlines or commas
    const simpleParse = (text) => text
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 120 && /[a-zA-Z]/.test(s));

    const apiKey = config.llm?.anthropic?.apiKey;
    if (!apiKey) {
      // No LLM — return simple parse
      return res.json({ authors: simpleParse(rawText), parsed: false });
    }

    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey });

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Extract a clean list of researcher/scholar names from the following text. Return ONLY a JSON array of strings, one name per element, with proper capitalization. Remove duplicates, affiliation info, and titles (Dr., Prof., etc.). Do not add any explanation.\n\nInput:\n${rawText}`,
      }],
    });

    const responseText = message.content?.[0]?.text || '';
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        const authors = parsed.map((s) => String(s || '').trim()).filter((s) => s.length > 1);
        return res.json({ authors, parsed: true });
      }
    }
    // LLM response not parseable — fall back to simple
    return res.json({ authors: simpleParse(rawText), parsed: false });
  } catch (e) {
    console.error('[tracker] POST /parse-author-names error:', e);
    // Fall back gracefully
    const fallback = String(req.body?.text || '').split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.length > 1);
    return res.json({ authors: fallback, parsed: false });
  }
});

module.exports = router;
