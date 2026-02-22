const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const config = require('../config');
const paperTracker = require('../services/paper-tracker.service');
const hfTracker = require('../services/hf-tracker.service');
const twitterPlaywrightTracker = require('../services/twitter-playwright-tracker.service');
const trackerProxy = require('../services/tracker-proxy.service');
const {
  extractTwitterHandle,
  normalizeTwitterProfileLinks,
} = require('../utils/twitter-profile-links');
const { getDb } = require('../db');

// ─── Feed cache (24h TTL, in-memory) ────────────────────────────────────────
const FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let feedCache = { data: [], fetchedAt: null };

// GET /api/tracker/feed — latest papers from HuggingFace (cached 24h)
// ?debug=1 bypasses cache  ?offset=N ?limit=N (default 5)
router.get('/feed', async (req, res) => {
  try {
    const debug = req.query.debug === '1';
    const parsedLimit = parseInt(req.query.limit || '5', 10);
    const parsedOffset = parseInt(req.query.offset || '0', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 50)) : 5;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const now = Date.now();
    const cacheAge = feedCache.fetchedAt ? now - feedCache.fetchedAt : Infinity;

    if (!debug && cacheAge < FEED_CACHE_TTL_MS && feedCache.data.length > 0) {
      const pageData = feedCache.data.slice(offset, offset + limit);
      return res.json({
        data: pageData,
        cached: true,
        fetchedAt: new Date(feedCache.fetchedAt).toISOString(),
        offset,
        limit,
        hasMore: offset + pageData.length < feedCache.data.length,
        total: feedCache.data.length,
      });
    }

    // Fetch fresh HF daily papers (recent 2 days so we still have results if today is not published yet)
    const papers = await hfTracker.getNewPapers({ lookbackDays: 2, minUpvotes: 0 });

    // Sort by upvotes descending
    papers.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));

    // Check which are already saved in the library
    const db = getDb();
    const annotated = await Promise.all(
      papers.map(async (p) => {
        const r = await db.execute({
          sql: `SELECT 1 FROM documents WHERE original_url LIKE ? LIMIT 1`,
          args: [`%arxiv.org%${p.arxivId}%`],
        });
        return { ...p, saved: r.rows.length > 0 };
      })
    );

    feedCache = { data: annotated, fetchedAt: now };
    const pageData = annotated.slice(offset, offset + limit);
    res.json({
      data: pageData,
      cached: false,
      fetchedAt: new Date(now).toISOString(),
      offset,
      limit,
      hasMore: offset + pageData.length < annotated.length,
      total: annotated.length,
    });
  } catch (e) {
    console.error('[tracker] GET /feed error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/tracker/feed/invalidate — force feed cache refresh (auth required)
router.post('/feed/invalidate', requireAuth, (req, res) => {
  feedCache = { data: [], fetchedAt: null };
  res.json({ ok: true });
});

// GET /api/tracker/sources — list all sources
router.get('/sources', async (req, res) => {
  try {
    const sources = await paperTracker.getSources();
    // Redact sensitive config fields (passwords) for non-auth callers
    const authHeader = req.headers.authorization;
    const isAuth = !!authHeader;
    const safeSources = sources.map((s) => ({
      ...s,
      config: isAuth ? s.config : redactConfig(s.config),
    }));
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
    const validTypes = ['hf', 'twitter', 'scholar'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
    const normalizedConfig = normalizeSourceConfig(type, config || {});
    const id = await paperTracker.addSource(type, name, normalizedConfig);
    res.status(201).json({ id, type, name, config: normalizedConfig, enabled: true });
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
      normalizedConfig = normalizeSourceConfig(sourceType, config);
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
      return res.json({ ...status, proxied: true });
    } catch (e) {
      console.warn('[tracker] proxy status failed, falling back to local:', e.message);
    }
  }
  return res.json({ ...paperTracker.getStatus(), proxied: false });
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

function normalizeSourceConfig(type, config) {
  if (type === 'twitter') return normalizeTwitterConfig(config);
  return config || {};
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

module.exports = router;
