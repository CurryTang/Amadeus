const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const os = require('os');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const config = require('../config');
const paperTracker = require('../services/paper-tracker.service');
const hfTracker = require('../services/hf-tracker.service');
const twitterTracker = require('../services/twitter-tracker.service');
const alphaxivTracker = require('../services/alphaxiv-tracker.service');
const twitterPlaywrightTracker = require('../services/twitter-playwright-tracker.service');
const financeTracker = require('../services/finance-tracker.service');
const rssTracker = require('../services/rss-tracker.service');
const arxivService = require('../services/arxiv.service');
const trackerProxy = require('../services/tracker-proxy.service');
const {
  buildTrackerFeedSnapshotId,
  createTrackerFeedPageCache,
  resolveTrackerFeedAnnotatedPage,
} = require('../services/tracker-feed-snapshot.service');
const {
  extractTwitterHandle,
  normalizeTwitterProfileLinks,
} = require('../utils/twitter-profile-links');
const { getDb } = require('../db');

// ─── Feed cache (24h TTL, in-memory) ────────────────────────────────────────
const FEED_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FEED_CACHE_SOFT_TTL_MS = (() => {
  const raw = parseInt(process.env.TRACKER_FEED_CACHE_SOFT_TTL_MS || String(15 * 60 * 1000), 10);
  if (!Number.isFinite(raw)) return 15 * 60 * 1000;
  return Math.max(60 * 1000, Math.min(raw, FEED_CACHE_TTL_MS));
})();
let feedCache = { data: [], fetchedAt: null, perSource: [] };
const FEED_SUPPORTED_SOURCE_TYPES = ['hf', 'twitter', 'arxiv_authors', 'alphaxiv', 'finance', 'rss'];
const GENERIC_SOURCE_PRIORITY = { twitter: 5, arxiv_authors: 4, hf: 3, rss: 2, finance: 2, alphaxiv: 1, arxiv: 1 };
const FEED_SORT_SOURCE_PRIORITY = { twitter: 5, arxiv_authors: 4, hf: 3, rss: 2, finance: 2, alphaxiv: 1, arxiv: 1 };
const SOURCE_TYPE_ALIASES = { arxiv: 'alphaxiv', huggingface: 'hf', x: 'twitter' };
const FEED_RECENCY_HALFLIFE_HOURS = Number.isFinite(parseInt(process.env.TRACKER_FEED_RECENCY_HALFLIFE_HOURS || '72', 10))
  ? Math.max(6, Math.min(parseInt(process.env.TRACKER_FEED_RECENCY_HALFLIFE_HOURS || '72', 10), 24 * 14))
  : 72;
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
const FEED_PERSONALIZATION_ENABLED = String(process.env.TRACKER_FEED_PERSONALIZATION || 'true').toLowerCase() !== 'false';
const FEED_PERSONALIZATION_PROFILE_TTL_MS = parseInt(process.env.TRACKER_FEED_PROFILE_TTL_MS || String(5 * 60 * 1000), 10);
const FEED_PERSONALIZATION_HISTORY_DAYS = parseInt(process.env.TRACKER_FEED_PROFILE_DAYS || '60', 10);
const FEED_PERSONALIZATION_MAX_EVENTS = parseInt(process.env.TRACKER_FEED_PROFILE_MAX_EVENTS || '1200', 10);
const FEED_PERSONALIZATION_MAX_TOKENS = parseInt(process.env.TRACKER_FEED_PROFILE_MAX_TOKENS || '200', 10);
const FEED_PERSONALIZATION_LOOKAHEAD = parseInt(process.env.TRACKER_FEED_PERSONAL_LOOKAHEAD || '64', 10);
const TRACKER_EVENT_TYPES = new Set(['impression', 'open', 'save', 'mark_read', 'dismiss']);
const TRACKER_EVENT_TYPE_WEIGHTS = {
  impression: 0.2,
  open: 1.2,
  save: 4.2,
  mark_read: 2.4,
  dismiss: -2.1,
};
const TRACKER_PROFILE_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'on', 'at', 'with', 'without', 'by',
  'from', 'into', 'out', 'up', 'down', 'over', 'under', 'about', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its', 'their', 'our', 'your',
  'paper', 'papers', 'study', 'using', 'based', 'toward', 'towards', 'new', 'via', 'toward',
]);
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
const userFeedProfileCache = new Map();
const trackerFeedPageCache = createTrackerFeedPageCache();

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

function extractArxivIdFromText(text = '') {
  const raw = String(text || '');
  if (!raw) return '';
  const urlPattern = /https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/ig;
  const urlMatch = raw.match(urlPattern);
  if (urlMatch && urlMatch.length > 0) {
    for (const candidate of urlMatch) {
      const parsed = arxivService.parseArxivUrl(candidate);
      const normalized = normalizeArxivId(parsed);
      if (normalized) return normalized;
    }
  }
  const idMatch = raw.match(/\b(\d{4}\.\d{4,5}(?:v\d+)?)\b/i);
  if (idMatch?.[1]) return normalizeArxivId(idMatch[1]);
  return '';
}

function extractArxivIdFromRssItem(raw = {}) {
  const directUrl = String(raw?.url || raw?.link || '').trim();
  if (directUrl) {
    const directParsed = normalizeArxivId(arxivService.parseArxivUrl(directUrl));
    if (directParsed) return directParsed;
  }

  // Fallback: allow RSS entries that embed explicit arXiv links/IDs in title or summary.
  return (
    extractArxivIdFromText(raw?.title)
    || extractArxivIdFromText(raw?.summary)
    || extractArxivIdFromText(raw?.abstract)
    || ''
  );
}

function parsePostedAt(raw) {
  if (!raw) return '';
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

function normalizeTrackerSourceType(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (!normalized) return '';
  if (typeof paperTracker?.canonicalizeSourceType === 'function') {
    return paperTracker.canonicalizeSourceType(normalized);
  }
  return SOURCE_TYPE_ALIASES[normalized] || normalized;
}

function getSourcePriority(type) {
  return GENERIC_SOURCE_PRIORITY[normalizeTrackerSourceType(type)] || 0;
}

function getFeedSortSourcePriority(type) {
  return FEED_SORT_SOURCE_PRIORITY[normalizeTrackerSourceType(type)] || 0;
}

function getSourceWeightFromConfig(config = {}) {
  const raw = parseInt(config?.priorityWeight ?? config?.weight ?? '0', 10);
  if (!Number.isFinite(raw)) return 0;
  return raw;
}

function getSourceWeightFromItem(item = {}) {
  const raw = parseInt(item?.sourceWeight ?? '0', 10);
  if (!Number.isFinite(raw)) return 0;
  return raw;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function getItemTimestampMs(item = {}) {
  const ms = new Date(item.trackedDate || item.publishedAt || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function computeFeedItemRecencyScore(item = {}, nowMs = Date.now()) {
  const ts = getItemTimestampMs(item);
  if (!ts || ts <= 0) return 0;
  const ageHours = Math.max(0, (nowMs - ts) / (60 * 60 * 1000));
  return clamp01(Math.exp(-ageHours / FEED_RECENCY_HALFLIFE_HOURS));
}

function computeFeedItemEngagementScore(item = {}) {
  const upvotes = Math.max(0, Number(item.upvotes || 0) || 0);
  const views = Math.max(0, Number(item.views || 0) || 0);
  const score = Math.max(0, Number(item.score || 0) || 0);
  const upvoteScore = clamp01(Math.log1p(upvotes) / Math.log(101));
  const viewScore = clamp01(Math.log1p(views) / Math.log(50001));
  const scoreScore = clamp01(Math.log1p(score) / Math.log(1001));
  return (0.5 * upvoteScore) + (0.3 * viewScore) + (0.2 * scoreScore);
}

function computeFeedItemTypeBoost(item = {}) {
  const type = String(item.itemType || (item.arxivId ? 'paper' : '')).toLowerCase();
  if (type === 'paper') return 0.06;
  if (type === 'article') return 0.03;
  if (type === 'finance') return 0.01;
  return 0;
}

function computeFeedRankScore(item = {}, nowMs = Date.now()) {
  const sourceWeightScore = clamp01(getSourceWeightFromItem(item) / 20);
  const sourcePriorityScore = clamp01(getBestFeedSortPriority(item) / 5);
  const recencyScore = computeFeedItemRecencyScore(item, nowMs);
  const engagementScore = computeFeedItemEngagementScore(item);
  return (
    (0.45 * sourceWeightScore) +
    (0.30 * recencyScore) +
    (0.15 * engagementScore) +
    (0.10 * sourcePriorityScore) +
    computeFeedItemTypeBoost(item)
  );
}

function getFeedSourceKey(item = {}) {
  const sourceType = normalizeTrackerSourceType(item.sourceType) || 'unknown';
  const sourceName = String(item.sourceName || '').trim().toLowerCase() || 'unknown';
  return `${sourceType}::${sourceName}`;
}

function sortAndDiversifyBucket(items = [], scoreOf, nowMs = Date.now()) {
  return [...items].sort((a, b) => {
    const rankA = scoreOf(a);
    const rankB = scoreOf(b);
    if (rankB !== rankA) return rankB - rankA;
    const timeA = getItemTimestampMs(a);
    const timeB = getItemTimestampMs(b);
    if (timeB !== timeA) return timeB - timeA;
    const scoreA = Number(a.score || 0) || 0;
    const scoreB = Number(b.score || 0) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

function rankAndDiversifyFeedItems(items = []) {
  if (!Array.isArray(items) || items.length <= 1) return Array.isArray(items) ? [...items] : [];
  const nowMs = Date.now();
  const scoreCache = new WeakMap();
  const scoreOf = (item) => {
    if (!item || typeof item !== 'object') return 0;
    if (scoreCache.has(item)) return scoreCache.get(item);
    const value = computeFeedRankScore(item, nowMs);
    scoreCache.set(item, value);
    return value;
  };

  const buckets = new Map();
  for (const item of items) {
    const key = getFeedSourceKey(item);
    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        sourceWeight: getSourceWeightFromItem(item),
        sourcePriority: getBestFeedSortPriority(item),
        sourceType: String(item.sourceType || '').toLowerCase(),
        sourceName: String(item.sourceName || ''),
        items: [],
      });
    }
    const bucket = buckets.get(key);
    bucket.sourceWeight = Math.max(bucket.sourceWeight, getSourceWeightFromItem(item));
    bucket.sourcePriority = Math.max(bucket.sourcePriority, getBestFeedSortPriority(item));
    bucket.items.push(item);
  }

  const orderedBuckets = [...buckets.values()].map((bucket) => {
    const sortedItems = sortAndDiversifyBucket(bucket.items, scoreOf, nowMs);
    return {
      ...bucket,
      items: sortedItems,
      headScore: sortedItems.length > 0 ? scoreOf(sortedItems[0]) : 0,
      headTime: sortedItems.length > 0 ? getItemTimestampMs(sortedItems[0]) : 0,
    };
  }).sort((a, b) => {
    if (b.sourceWeight !== a.sourceWeight) return b.sourceWeight - a.sourceWeight;
    if (b.sourcePriority !== a.sourcePriority) return b.sourcePriority - a.sourcePriority;
    if (b.headScore !== a.headScore) return b.headScore - a.headScore;
    if (b.headTime !== a.headTime) return b.headTime - a.headTime;
    return String(a.sourceName || '').localeCompare(String(b.sourceName || ''));
  });

  const result = [];
  let remaining = items.length;
  while (remaining > 0) {
    let pushedInRound = 0;
    for (const bucket of orderedBuckets) {
      if (!bucket.items.length) continue;
      result.push(bucket.items.shift());
      remaining -= 1;
      pushedInRound += 1;
    }
    if (pushedInRound === 0) break;
  }
  return result;
}

function getBestFeedSortPriority(item = {}) {
  const sourceTypes = Array.isArray(item.sourceTypes) ? item.sourceTypes : [];
  const primaryType = normalizeTrackerSourceType(item.sourceType);
  const candidates = [...sourceTypes, primaryType].filter(Boolean);
  if (candidates.length === 0) return 0;
  return Math.max(...candidates.map((type) => getFeedSortSourcePriority(type)));
}

function normalizeTitle(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isLikelySocialPostTitle(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;

  // Strong tweet/post indicators.
  if (/https?:\/\//i.test(normalized)) return true;
  if (/(^|\s)#\w+/.test(normalized)) return true;
  if (/(^|\s)@\w+/.test(normalized)) return true;
  if (/^\d{1,2}\s*\/\s*\d{1,2}\b/.test(normalized)) return true; // thread marker: "9/ ..."

  // Weaker indicator blend to avoid false positives on legitimate titles.
  let weakSignals = 0;
  if (normalized.length >= 180) weakSignals += 1;
  if (/\b(full review|what do you think|read this paper|paper:)\b/i.test(normalized)) weakSignals += 1;
  if (/[!?]\s*$/.test(normalized)) weakSignals += 1;
  return weakSignals >= 2;
}

function isLowSignalTitle(title) {
  const normalized = normalizeTitle(title).toLowerCase();
  if (!normalized) return true;
  if (/^arxiv[:\s]/i.test(normalized)) return true;
  if (normalized === 'paper' || normalized === 'papers') return true;
  if (normalized === 'new paper' || normalized === 'new papers') return true;
  if (normalized === 'paper:' || normalized === 'papers:') return true;
  if (isLikelySocialPostTitle(normalized)) return true;
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
    normalizeTrackerSourceType(existing.sourceType),
    normalizeTrackerSourceType(incoming.sourceType),
  ].filter(Boolean));

  const titleA = normalizeTitle(existing.title);
  const titleB = normalizeTitle(incoming.title);

  const abstractA = String(existing.abstract || '');
  const abstractB = String(incoming.abstract || '');
  const betterAbstract = abstractA.length >= abstractB.length ? abstractA : abstractB;

  const authorsA = Array.isArray(existing.authors) ? existing.authors : [];
  const authorsB = Array.isArray(incoming.authors) ? incoming.authors : [];
  const betterAuthors = authorsA.length >= authorsB.length ? authorsA : authorsB;

  const sourceTypeA = normalizeTrackerSourceType(existing.sourceType);
  const sourceTypeB = normalizeTrackerSourceType(incoming.sourceType);
  const sourceWeightA = getSourceWeightFromItem(existing);
  const sourceWeightB = getSourceWeightFromItem(incoming);
  const keepIncomingSource = sourceWeightB > sourceWeightA
    || (sourceWeightB === sourceWeightA && getSourcePriority(sourceTypeB) >= getSourcePriority(sourceTypeA));

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
    sourceWeight: Math.max(sourceWeightA, sourceWeightB),
    upvotes: Math.max(Number(existing.upvotes || 0), Number(incoming.upvotes || 0)),
    views: Math.max(Number(existing.views || 0), Number(incoming.views || 0)),
    score: Math.max(Number(existing.score || 0), Number(incoming.score || 0)),
    saved: Boolean(existing.saved || incoming.saved),
  };
}

function mergeSourceGenericItem(existing, incoming) {
  const names = new Set([
    ...(Array.isArray(existing.sourceNames) ? existing.sourceNames : []),
    ...(Array.isArray(incoming.sourceNames) ? incoming.sourceNames : []),
    existing.sourceName,
    incoming.sourceName,
  ].filter(Boolean));
  const types = new Set([
    ...(Array.isArray(existing.sourceTypes) ? existing.sourceTypes : []),
    ...(Array.isArray(incoming.sourceTypes) ? incoming.sourceTypes : []),
    normalizeTrackerSourceType(existing.sourceType),
    normalizeTrackerSourceType(incoming.sourceType),
  ].filter(Boolean));

  const sourceTypeA = normalizeTrackerSourceType(existing.sourceType);
  const sourceTypeB = normalizeTrackerSourceType(incoming.sourceType);
  const sourceWeightA = getSourceWeightFromItem(existing);
  const sourceWeightB = getSourceWeightFromItem(incoming);
  const keepIncomingSource = sourceWeightB > sourceWeightA
    || (sourceWeightB === sourceWeightA && getSourcePriority(sourceTypeB) >= getSourcePriority(sourceTypeA));

  const summaryA = String(existing.summary || existing.abstract || '');
  const summaryB = String(incoming.summary || incoming.abstract || '');
  const itemType = String(incoming.itemType || existing.itemType || 'article');
  const fallbackTitle = itemType === 'finance' ? 'Finance headline' : 'Tracked article';
  const linkA = String(existing.url || '').trim();
  const linkB = String(incoming.url || '').trim();

  return {
    ...existing,
    ...incoming,
    itemType,
    title: normalizeTitle(incoming.title) || normalizeTitle(existing.title) || fallbackTitle,
    summary: summaryA.length >= summaryB.length ? summaryA : summaryB,
    abstract: summaryA.length >= summaryB.length ? summaryA : summaryB,
    url: linkA.length >= linkB.length ? linkA : linkB,
    sourceType: keepIncomingSource ? sourceTypeB : sourceTypeA,
    sourceName: keepIncomingSource ? (incoming.sourceName || existing.sourceName) : (existing.sourceName || incoming.sourceName),
    sourceNames: [...names],
    sourceTypes: [...types],
    sourceWeight: Math.max(sourceWeightA, sourceWeightB),
    publishedAt: existing.publishedAt || incoming.publishedAt || '',
    trackedDate: existing.trackedDate || incoming.trackedDate || '',
  };
}

function buildFeedItemKey(item) {
  if (!item) return '';
  if (item.itemType === 'finance' || item.itemType === 'article') {
    const external = String(item.externalId || item.url || '').trim();
    if (!external) return '';
    return `${item.itemType}:${external}`;
  }
  const arxivId = normalizeArxivId(item.arxivId);
  if (!arxivId) return '';
  return `paper:${arxivId}`;
}

function clampSigned(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return value;
}

function signedToUnit(value) {
  return clamp01((clampSigned(value) + 1) / 2);
}

function tokenizeRankingText(text = '') {
  if (!text) return [];
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const tokens = normalized.split(' ');
  const seen = new Set();
  const result = [];
  for (const token of tokens) {
    if (!token || token.length < 3 || token.length > 32) continue;
    if (TRACKER_PROFILE_STOP_WORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    result.push(token);
  }
  return result;
}

function tokenSetFromFeedItem(item = {}) {
  const text = [
    item.title || '',
    item.summary || '',
    item.abstract || '',
    Array.isArray(item.authors) ? item.authors.join(' ') : '',
    item.sourceName || '',
    item.sourceType || '',
  ].join(' ');
  return new Set(tokenizeRankingText(text));
}

function tokenSetJaccard(a = new Set(), b = new Set()) {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) overlap += 1;
  }
  const union = (a.size + b.size - overlap);
  if (union <= 0) return 0;
  return overlap / union;
}

function normalizeTrackerEventType(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return TRACKER_EVENT_TYPES.has(value) ? value : '';
}

function trimTo(raw, max = 512) {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (!Number.isFinite(max) || max <= 0 || text.length <= max) return text;
  return text.slice(0, max);
}

function normalizeTrackerEventPayload(raw = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const eventType = normalizeTrackerEventType(raw.type || raw.eventType);
  if (!eventType) return null;
  const itemType = String(raw.itemType || '').trim().toLowerCase() || 'paper';
  const arxivId = normalizeArxivId(raw.arxivId || '');
  const url = trimTo(raw.url || '', 2048);
  const externalId = trimTo(raw.externalId || '', 256);
  const sourceType = normalizeTrackerSourceType(raw.sourceType || '');
  const sourceName = trimTo(raw.sourceName || '', 180);
  const title = trimTo(raw.title || '', 500);
  const abstract = trimTo(raw.summary || raw.abstract || '', 1800);
  const authors = Array.isArray(raw.authors)
    ? raw.authors.map((name) => trimTo(name, 120)).filter(Boolean).slice(0, 10)
    : [];
  const rankPosition = Number.isFinite(Number(raw.position))
    ? Math.max(0, Math.min(1000, parseInt(raw.position, 10)))
    : 0;
  const rankScore = Number.isFinite(Number(raw.score))
    ? Number(Number(raw.score).toFixed(6))
    : 0;

  const explicitItemKey = trimTo(raw.itemKey || '', 300);
  const derivedItemKey = buildFeedItemKey({
    itemType,
    arxivId,
    externalId,
    url,
  });
  const itemKey = explicitItemKey || derivedItemKey;
  if (!itemKey) return null;

  const metadata = {
    title,
    abstract,
    authors,
  };

  return {
    eventType,
    itemType,
    itemKey,
    arxivId,
    url,
    sourceType,
    sourceName,
    rankPosition,
    rankScore,
    metadata,
  };
}

function getTrackerEventUserId(req, body = {}) {
  if (req?.isAuthenticated && req?.userId) {
    return String(req.userId || '').trim();
  }
  const anonSessionId = String(body?.anonSessionId || '').trim().toLowerCase();
  if (!anonSessionId) return '';
  if (!/^[a-z0-9_-]{8,80}$/.test(anonSessionId)) return '';
  return `anon:${anonSessionId}`;
}

async function saveTrackerEvents(userId, events = []) {
  if (!userId || !Array.isArray(events) || events.length === 0) return 0;
  const db = getDb();
  let stored = 0;
  for (const event of events) {
    // eslint-disable-next-line no-await-in-loop
    await db.execute({
      sql: `
        INSERT INTO tracker_item_events (
          user_id, event_type, item_key, item_type, arxiv_id, url, source_type, source_name,
          rank_position, rank_score, metadata_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        userId,
        event.eventType,
        event.itemKey,
        event.itemType || '',
        event.arxivId || '',
        event.url || '',
        event.sourceType || '',
        event.sourceName || '',
        event.rankPosition || 0,
        event.rankScore || 0,
        JSON.stringify(event.metadata || {}),
      ],
    });
    stored += 1;
  }
  return stored;
}

function eventSignalWeight(eventType, createdAt, rankPosition = 0) {
  const base = Number(TRACKER_EVENT_TYPE_WEIGHTS[eventType] || 0);
  if (!base) return 0;
  const eventMs = new Date(createdAt || '').getTime();
  const ageDays = Number.isFinite(eventMs)
    ? Math.max(0, (Date.now() - eventMs) / (24 * 60 * 60 * 1000))
    : 0;
  const recencyDecay = Math.exp(-ageDays / 45);
  const pos = Math.max(0, Number(rankPosition || 0) || 0);
  const topRankBoost = pos > 0 ? (1 + (0.18 * clamp01((20 - pos) / 20))) : 1;
  return base * recencyDecay * topRankBoost;
}

function mapToTopEntries(scoreMap = new Map(), limit = 8) {
  return [...scoreMap.entries()]
    .filter(([, value]) => Number.isFinite(value) && Math.abs(value) > 0.001)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, Math.max(1, limit))
    .map(([key, value]) => ({
      key,
      score: Number(value.toFixed(4)),
    }));
}

async function loadUserFeedProfile(userId = '') {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) return null;
  const cached = userFeedProfileCache.get(cleanUserId);
  const profileTtlMs = Number.isFinite(FEED_PERSONALIZATION_PROFILE_TTL_MS)
    ? Math.max(5000, Math.min(FEED_PERSONALIZATION_PROFILE_TTL_MS, 60 * 60 * 1000))
    : 5 * 60 * 1000;
  if (cached && (Date.now() - cached.fetchedAt) < profileTtlMs) {
    return cached.profile;
  }

  const historyDays = Number.isFinite(FEED_PERSONALIZATION_HISTORY_DAYS)
    ? Math.max(7, Math.min(FEED_PERSONALIZATION_HISTORY_DAYS, 365))
    : 60;
  const maxEvents = Number.isFinite(FEED_PERSONALIZATION_MAX_EVENTS)
    ? Math.max(50, Math.min(FEED_PERSONALIZATION_MAX_EVENTS, 5000))
    : 1200;
  const maxTokens = Number.isFinite(FEED_PERSONALIZATION_MAX_TOKENS)
    ? Math.max(20, Math.min(FEED_PERSONALIZATION_MAX_TOKENS, 800))
    : 200;

  const db = getDb();
  const rows = await db.execute({
    sql: `
      SELECT event_type, source_type, source_name, rank_position, metadata_json, created_at
      FROM tracker_item_events
      WHERE user_id = ?
        AND created_at >= datetime('now', ?)
      ORDER BY id DESC
      LIMIT ?
    `,
    args: [cleanUserId, `-${historyDays} days`, maxEvents],
  });

  const sourceTypeScores = new Map();
  const sourceNameScores = new Map();
  const keywordScores = new Map();
  let positiveSignal = 0;
  let negativeSignal = 0;
  const history = rows.rows || [];

  for (const row of history) {
    const eventType = normalizeTrackerEventType(row.event_type);
    if (!eventType) continue;
    const signal = eventSignalWeight(eventType, row.created_at, row.rank_position);
    if (!signal) continue;
    if (signal > 0) positiveSignal += signal;
    else negativeSignal += Math.abs(signal);

    const sourceType = normalizeTrackerSourceType(row.source_type);
    if (sourceType) {
      sourceTypeScores.set(sourceType, (sourceTypeScores.get(sourceType) || 0) + signal);
    }
    const sourceName = String(row.source_name || '').trim().toLowerCase();
    if (sourceName) {
      sourceNameScores.set(sourceName, (sourceNameScores.get(sourceName) || 0) + signal);
    }

    const metadata = safeParseJson(row.metadata_json, {});
    const tokens = tokenizeRankingText([
      metadata?.title || '',
      metadata?.abstract || '',
      Array.isArray(metadata?.authors) ? metadata.authors.join(' ') : '',
    ].join(' '));
    for (const token of tokens.slice(0, 24)) {
      keywordScores.set(token, (keywordScores.get(token) || 0) + signal);
    }
  }

  const prunedKeywordScores = new Map(
    [...keywordScores.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, maxTokens)
  );
  const sourceTypeScale = Math.max(1, ...[...sourceTypeScores.values()].map((value) => Math.abs(value)));
  const sourceNameScale = Math.max(1, ...[...sourceNameScores.values()].map((value) => Math.abs(value)));
  const keywordScale = Math.max(1, ...[...prunedKeywordScores.values()].map((value) => Math.abs(value)));

  const profile = {
    userId: cleanUserId,
    eventCount: history.length,
    positiveSignal: Number(positiveSignal.toFixed(3)),
    negativeSignal: Number(negativeSignal.toFixed(3)),
    sourceTypeScores,
    sourceNameScores,
    keywordScores: prunedKeywordScores,
    sourceTypeScale,
    sourceNameScale,
    keywordScale,
    topSourceTypes: mapToTopEntries(sourceTypeScores, 8),
    topKeywords: mapToTopEntries(prunedKeywordScores, 10),
  };
  userFeedProfileCache.set(cleanUserId, { profile, fetchedAt: Date.now() });
  return profile;
}

function profileHasSignal(profile = null) {
  if (!profile) return false;
  const totalSignal = Math.max(0, Number(profile.positiveSignal || 0)) + Math.max(0, Number(profile.negativeSignal || 0));
  if (totalSignal < 0.6) return false;
  return (profile.sourceTypeScores?.size || 0) > 0 || (profile.keywordScores?.size || 0) > 0;
}

function itemSourceAffinityScore(profile, item = {}) {
  if (!profileHasSignal(profile)) return 0;
  const sourceType = normalizeTrackerSourceType(item.sourceType || '');
  const sourceName = String(item.sourceName || '').trim().toLowerCase();
  const typeRaw = sourceType ? (profile.sourceTypeScores.get(sourceType) || 0) : 0;
  const nameRaw = sourceName ? (profile.sourceNameScores.get(sourceName) || 0) : 0;
  const typeScore = clampSigned(typeRaw / Math.max(1, Number(profile.sourceTypeScale || 1)));
  const nameScore = clampSigned(nameRaw / Math.max(1, Number(profile.sourceNameScale || 1)));
  return clampSigned((0.7 * typeScore) + (0.3 * nameScore));
}

function itemKeywordAffinityScore(profile, tokenSet = new Set()) {
  if (!profileHasSignal(profile) || !tokenSet.size) return 0;
  let sum = 0;
  let matched = 0;
  for (const token of tokenSet) {
    if (!profile.keywordScores.has(token)) continue;
    sum += profile.keywordScores.get(token) || 0;
    matched += 1;
  }
  if (matched === 0) return 0;
  const normalized = sum / (Math.max(1, matched) * Math.max(1, Number(profile.keywordScale || 1)));
  return clampSigned(normalized);
}

function computePersonalizedFeedScore(item = {}, profile, tokenSet = new Set(), nowMs = Date.now()) {
  const baseScore = computeFeedRankScore(item, nowMs);
  const sourceAffinity = itemSourceAffinityScore(profile, item);
  const keywordAffinity = itemKeywordAffinityScore(profile, tokenSet);
  const personalAffinity = clampSigned((0.58 * sourceAffinity) + (0.42 * keywordAffinity));
  const freshness = computeFeedItemRecencyScore(item, nowMs);
  const engagement = computeFeedItemEngagementScore(item);
  const finalScore = (
    (0.56 * baseScore) +
    (0.24 * signedToUnit(personalAffinity)) +
    (0.12 * freshness) +
    (0.08 * engagement)
  );
  return {
    finalScore,
    baseScore,
    personalAffinity,
    sourceAffinity,
    keywordAffinity,
    freshness,
    engagement,
  };
}

function rerankFeedItemsForUser(items = [], profile = null, { includeDebug = false } = {}) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length <= 1 || !profileHasSignal(profile)) {
    return {
      items: [...sourceItems],
      personalized: false,
      profileSummary: profile
        ? {
          eventCount: profile.eventCount,
          positiveSignal: profile.positiveSignal,
          negativeSignal: profile.negativeSignal,
          topSources: profile.topSourceTypes || [],
          topKeywords: profile.topKeywords || [],
        }
        : null,
    };
  }

  const nowMs = Date.now();
  const scored = sourceItems.map((item) => {
    const tokenSet = tokenSetFromFeedItem(item);
    const scoreBundle = computePersonalizedFeedScore(item, profile, tokenSet, nowMs);
    return {
      item,
      tokenSet,
      sourceKey: getFeedSourceKey(item),
      ...scoreBundle,
    };
  }).sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    const timeA = getItemTimestampMs(a.item);
    const timeB = getItemTimestampMs(b.item);
    if (timeB !== timeA) return timeB - timeA;
    return String(a.item?.title || '').localeCompare(String(b.item?.title || ''));
  });

  const result = [];
  const remaining = [...scored];
  const sourceCounts = new Map();
  const recentTokenSets = [];
  const lookahead = Number.isFinite(FEED_PERSONALIZATION_LOOKAHEAD)
    ? Math.max(12, Math.min(FEED_PERSONALIZATION_LOOKAHEAD, 200))
    : 64;

  while (remaining.length > 0) {
    const inspectCount = Math.min(lookahead, remaining.length);
    let bestIdx = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < inspectCount; i += 1) {
      const candidate = remaining[i];
      const sourceCount = sourceCounts.get(candidate.sourceKey) || 0;
      const sourcePenalty = Math.min(0.33, sourceCount * 0.11);
      let maxSimilarity = 0;
      const recentSlice = recentTokenSets.slice(-16);
      for (const selectedTokenSet of recentSlice) {
        const sim = tokenSetJaccard(candidate.tokenSet, selectedTokenSet);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }
      const topicPenalty = Math.min(0.25, maxSimilarity * 0.22);
      const adjusted = candidate.finalScore - sourcePenalty - topicPenalty;
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIdx = i;
      }
    }
    const [picked] = remaining.splice(bestIdx, 1);
    if (!picked) break;
    sourceCounts.set(picked.sourceKey, (sourceCounts.get(picked.sourceKey) || 0) + 1);
    if (picked.tokenSet.size > 0) recentTokenSets.push(picked.tokenSet);
    if (recentTokenSets.length > 40) recentTokenSets.shift();
    result.push({
      ...picked,
      adjustedScore: bestAdjusted,
    });
  }

  const rankedItems = result.map((entry, index) => {
    if (!includeDebug) return entry.item;
    return {
      ...entry.item,
      rankDebug: {
        rank: index + 1,
        adjustedScore: Number(entry.adjustedScore.toFixed(5)),
        finalScore: Number(entry.finalScore.toFixed(5)),
        baseScore: Number(entry.baseScore.toFixed(5)),
        personalAffinity: Number(entry.personalAffinity.toFixed(5)),
        sourceAffinity: Number(entry.sourceAffinity.toFixed(5)),
        keywordAffinity: Number(entry.keywordAffinity.toFixed(5)),
        freshness: Number(entry.freshness.toFixed(5)),
        engagement: Number(entry.engagement.toFixed(5)),
      },
    };
  });

  return {
    items: rankedItems,
    personalized: true,
    profileSummary: {
      eventCount: profile.eventCount,
      positiveSignal: profile.positiveSignal,
      negativeSignal: profile.negativeSignal,
      topSources: profile.topSourceTypes || [],
      topKeywords: profile.topKeywords || [],
    },
  };
}

function mergeFeedItems(existing, incoming) {
  if (!existing) return incoming;
  const existingType = String(existing.itemType || 'paper');
  const incomingType = String(incoming.itemType || 'paper');
  if (existingType !== 'paper' || incomingType !== 'paper') {
    return mergeSourceGenericItem(existing, incoming);
  }
  return mergeSourcePaper(existing, incoming);
}

function sortFeedPapers(items = []) {
  const unread = [];
  const read = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.isRead) read.push(item);
    else unread.push(item);
  }
  return [...rankAndDiversifyFeedItems(unread), ...rankAndDiversifyFeedItems(read)];
}

function partitionSavedOrReadItemsToEnd(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const active = [];
  const deprioritized = [];
  for (const item of items) {
    if (item?.saved || item?.isRead) deprioritized.push(item);
    else active.push(item);
  }
  return [...active, ...deprioritized];
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
    sourceWeight: Number(item?.sourceWeight || 0) || 0,
    saved: false,
    isRead: false,
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

async function invalidateFeedCache(reason = 'source_change') {
  feedCache = { data: [], fetchedAt: null, perSource: [], sourceCount: 0 };
  await clearPersistedFeedSnapshot();
  if (config.tracker?.enabled) {
    refreshFeedSnapshot(reason).catch(() => {});
  }
}

async function annotateSavedStatus(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const db = getDb();
  const paperItems = items.filter((item) => item.itemType !== 'finance' && item.arxivId);
  const articleItems = items.filter((item) =>
    String(item?.itemType || '').toLowerCase() === 'article'
    && String(item?.url || '').trim()
  );
  if (paperItems.length === 0) {
    if (articleItems.length === 0) {
      return items.map((item) => ({ ...item, saved: false, isRead: false }));
    }
  }

  const statusByUrl = new Map();
  if (articleItems.length > 0) {
    const CHUNK_SIZE = 50;
    for (let i = 0; i < articleItems.length; i += CHUNK_SIZE) {
      const chunk = articleItems.slice(i, i + CHUNK_SIZE);
      const urls = [...new Set(chunk.map((item) => String(item.url || '').trim()).filter(Boolean))];
      if (urls.length === 0) continue;
      const placeholders = urls.map(() => '?').join(', ');
      // eslint-disable-next-line no-await-in-loop
      const result = await db.execute({
        sql: `SELECT original_url, is_read FROM documents WHERE original_url IN (${placeholders})`,
        args: urls,
      });
      for (const row of result.rows || []) {
        const key = String(row.original_url || '').trim();
        if (!key) continue;
        const current = statusByUrl.get(key) || { saved: false, isRead: false };
        statusByUrl.set(key, {
          saved: true,
          isRead: current.isRead || Number(row.is_read || 0) === 1,
        });
      }
    }
  }

  // SQLite has a max expression depth of ~100; chunk queries to stay safe.
  const CHUNK_SIZE = 50;
  const statusByArxivId = new Map();
  if (paperItems.length > 0) {
    for (let i = 0; i < paperItems.length; i += CHUNK_SIZE) {
      const chunk = paperItems.slice(i, i + CHUNK_SIZE);
      const likeClauses = chunk.map(() => 'original_url LIKE ?').join(' OR ');
      const args = chunk.map((item) => `%arxiv.org%${item.arxivId}%`);
      // eslint-disable-next-line no-await-in-loop
      const result = await db.execute({
        sql: `SELECT original_url, is_read FROM documents WHERE ${likeClauses}`,
        args,
      });
      for (const row of result.rows || []) {
        const url = String(row.original_url || '');
        const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
        if (!match?.[1]) continue;
        const arxivId = normalizeArxivId(match[1]);
        const current = statusByArxivId.get(arxivId) || { saved: false, isRead: false };
        statusByArxivId.set(arxivId, {
          saved: true,
          isRead: current.isRead || Number(row.is_read || 0) === 1,
        });
      }
    }
  }

  return items.map((item) => {
    if (String(item.itemType || '').toLowerCase() === 'article') {
      const status = statusByUrl.get(String(item.url || '').trim());
      return {
        ...item,
        saved: Boolean(status?.saved),
        isRead: Boolean(status?.isRead),
      };
    }
    if (item.itemType === 'finance' || !item.arxivId) return { ...item, saved: false, isRead: false };
    const status = statusByArxivId.get(normalizeArxivId(item.arxivId));
    return {
      ...item,
      saved: Boolean(status?.saved),
      isRead: Boolean(status?.isRead),
    };
  });
}

function mapArchivedPostsToPapers(posts = [], source) {
  const results = [];
  const seen = new Set();
  const normalizedSourceType = normalizeTrackerSourceType(source.type);
  const sourceName = source.name || source.type;
  const sourceWeight = getSourceWeightFromConfig(source.config || {});

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
        sourceWeight,
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
  const normalizedSourceType = normalizeTrackerSourceType(source.type);
  const sourceName = source.name || source.type;
  const sourceWeight = getSourceWeightFromConfig(source.config || {});
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
    sourceWeight,
    upvotes: Number(raw?.upvotes || 0) || 0,
    views: Number(raw?.views || 0) || 0,
    score,
    saved: false,
  };
}

function normalizeFeedFinanceItem(raw, source) {
  const externalId = String(raw?.externalId || raw?.url || '').trim();
  if (!externalId) return null;
  const normalizedSourceType = normalizeTrackerSourceType(source.type);
  const sourceName = source.name || source.type;
  const sourceWeight = getSourceWeightFromConfig(source.config || {});
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
    sourceWeight,
    score: Number(raw?.score || 0) || 0,
    saved: false,
  };
}

function normalizeFeedArticleItem(raw, source) {
  const externalId = String(raw?.externalId || raw?.url || '').trim();
  if (!externalId) return null;
  const arxivId = extractArxivIdFromRssItem(raw);
  const normalizedSourceType = normalizeTrackerSourceType(source.type);
  const sourceName = source.name || source.type;
  const sourceWeight = getSourceWeightFromConfig(source.config || {});
  const summary = String(raw?.summary || '').trim();
  const author = String(raw?.author || '').trim();
  const preferredUrl = String(raw?.url || '').trim();
  const normalizedUrl = preferredUrl || (arxivId ? `https://arxiv.org/abs/${arxivId}` : '');
  const itemType = arxivId ? 'paper' : 'article';

  return {
    itemType,
    ...(arxivId ? { arxivId } : {}),
    externalId,
    title: arxivId
      ? chooseBestTitle(raw?.title, `arXiv:${arxivId}`, arxivId)
      : (normalizeTitle(raw?.title) || 'Tracked article'),
    abstract: summary,
    summary,
    url: normalizedUrl,
    authors: author ? [author] : [],
    publishedAt: parsePostedAt(raw?.publishedAt),
    trackedDate: parsePostedAt(raw?.trackedDate || raw?.publishedAt),
    sourceType: normalizedSourceType,
    sourceName,
    sourceTypes: [normalizedSourceType],
    sourceNames: [sourceName],
    sourceWeight,
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

function hasLowSignalTwitterTitles(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((item) => {
    if (!item?.arxivId) return false;
    const primaryType = normalizeTrackerSourceType(item?.sourceType);
    const sourceTypes = Array.isArray(item?.sourceTypes) ? item.sourceTypes : [];
    const isTwitter = primaryType === 'twitter'
      || sourceTypes.some((type) => normalizeTrackerSourceType(type) === 'twitter');
    if (!isTwitter) return false;
    return isLowSignalTitle(item.title);
  });
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
  const weakCandidates = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => needsArxivEnrichment(item));

  const twitterCandidates = weakCandidates.filter(({ item }) =>
    String(item?.sourceType || '').toLowerCase() === 'twitter'
  );
  const nonTwitterCandidates = weakCandidates.filter(({ item }) =>
    String(item?.sourceType || '').toLowerCase() !== 'twitter'
  );

  // Always prioritize weak-title Twitter items so social-post text is replaced
  // by canonical paper metadata titles whenever possible.
  const cap = Math.max(FEED_METADATA_ENRICH_MAX, twitterCandidates.length);
  const candidates = [...twitterCandidates, ...nonTwitterCandidates].slice(0, cap);

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
  const lookbackRaw = parseInt(config.lookbackDays ?? config.maxAgeDays ?? '', 10);
  const lookbackDays = Number.isFinite(lookbackRaw) ? Math.max(1, Math.min(lookbackRaw, 3650)) : 0;
  const hasTextFilters = keywords.length > 0 || watchedAuthors.length > 0;
  if (!hasTextFilters && lookbackDays <= 0) return items;
  const nowMs = Date.now();
  const maxAgeMs = lookbackDays > 0 ? lookbackDays * 24 * 60 * 60 * 1000 : 0;
  return items.filter((item) => {
    if (maxAgeMs > 0) {
      const itemMs = getItemTimestampMs(item);
      if (!itemMs || itemMs <= 0) return false;
      if (nowMs - itemMs > maxAgeMs) return false;
    }
    if (!hasTextFilters) return true;
    const titleAbstract = `${item.title || ''} ${item.abstract || ''}`.toLowerCase();
    if (keywords.length > 0 && keywords.some((kw) => titleAbstract.includes(kw))) return true;
    const authorText = (item.authors || []).join(' ').toLowerCase();
    if (watchedAuthors.length > 0 && watchedAuthors.some((wa) => authorText.includes(wa))) return true;
    return false;
  });
}

async function fetchSourceFeedPapers(source, { debug = false } = {}) {
  const sourceType = normalizeTrackerSourceType(source.type);
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
    else if (sourceType === 'alphaxiv' || sourceType === 'arxiv') {
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
    else if (sourceType === 'rss') {
      const raw = await withTimeout(() => rssTracker.getLatestItems(source.config || {}));
      items = raw.map((item) => normalizeFeedArticleItem(item, source)).filter(Boolean);
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
    source.enabled && FEED_SUPPORTED_SOURCE_TYPES.includes(normalizeTrackerSourceType(source.type))
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
router.get('/feed', optionalAuth, async (req, res) => {
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
    let softStale = false;

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
      }
    }

    if (!debug && snapshot?.fetchedAt) {
      const snapshotAgeMs = now - Number(snapshot.fetchedAt);
      if (Number.isFinite(snapshotAgeMs) && snapshotAgeMs >= FEED_CACHE_SOFT_TTL_MS) {
        softStale = true;
        if (config.tracker?.enabled && !feedRefreshRunning) {
          refreshFeedSnapshot(`soft_stale_${cacheSource}`).catch(() => {});
        }
      }
    }

    if (!debug && snapshot && hasLowSignalTwitterTitles(snapshot.data)) {
      try {
        if (!feedRefreshRunning) {
          const refreshed = await withTimeout(
            () => refreshFeedSnapshot('stale_low_signal_twitter_titles'),
            FEED_REQUEST_TIMEOUT_MS,
            'feed_stale_title_refresh'
          );
          if (refreshed?.data?.length) {
            snapshot = refreshed;
            cacheSource = 'live';
          }
        } else {
          cacheSource = `${cacheSource}-stale`;
        }
      } catch (refreshError) {
        console.warn(
          '[tracker] stale twitter-title refresh failed, serving cached snapshot:',
          refreshError.message || refreshError
        );
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
    let rankingMode = 'default';
    let rankingProfile = null;
    const personalizationUserId = String(
      req.userId
      || getTrackerEventUserId(req, { anonSessionId: req.query?.anonSessionId || '' })
      || ''
    ).trim();
    if (FEED_PERSONALIZATION_ENABLED && personalizationUserId && sourceData.length > 1) {
      try {
        const profile = await withTimeout(
          () => loadUserFeedProfile(personalizationUserId),
          FEED_PAGE_ANNOTATE_TIMEOUT_MS,
          'feed_personal_profile'
        );
        const reranked = rerankFeedItemsForUser(sourceData, profile, { includeDebug: debug });
        if (reranked?.personalized && Array.isArray(reranked.items) && reranked.items.length === sourceData.length) {
          sourceData = reranked.items;
          rankingMode = 'personalized';
        }
        if (debug) rankingProfile = reranked?.profileSummary || null;
      } catch (profileError) {
        console.warn('[tracker] feed personalization skipped:', profileError.message || profileError);
      }
    }
    let shuffled = false;
    let fullAnnotated = false;

    // Always annotate full feed first so saved/read papers can be pushed to the global
    // tail before pagination. Within active/deprioritized partitions, keep ranking order.
    try {
      const annotatedAll = await withTimeout(
        () => annotateSavedStatus(sourceData),
        FEED_PAGE_ANNOTATE_TIMEOUT_MS * 3,
        'feed_saved_status_full'
      );
      sourceData = partitionSavedOrReadItemsToEnd(annotatedAll);
      fullAnnotated = true;
      shuffled = Boolean(shuffleRequested && offset === 0 && sourceData.some((item) => item?.isRead || item?.saved));
    } catch (fullAnnotateError) {
      console.warn('[tracker] full annotate failed, falling back to page annotate:', fullAnnotateError.message || fullAnnotateError);
    }

    const snapshotId = buildTrackerFeedSnapshotId({
      data: sourceData,
      fetchedAt: snapshot.fetchedAt,
      sourceCount: snapshot.sourceCount,
    });
    const viewerKey = String(
      req.userId
      || getTrackerEventUserId(req, { anonSessionId: req.query?.anonSessionId || '' })
      || 'public'
    ).trim() || 'public';
    const page = await resolveTrackerFeedAnnotatedPage({
      cacheState: trackerFeedPageCache,
      snapshot: {
        data: sourceData,
        fetchedAt: snapshot.fetchedAt,
        sourceCount: snapshot.sourceCount,
      },
      offset,
      limit,
      viewerKey,
      annotatePage: async (rawPageData) => {
        if (fullAnnotated) {
          return rawPageData;
        }
        try {
          return await withTimeout(
            () => annotateSavedStatus(rawPageData),
            FEED_PAGE_ANNOTATE_TIMEOUT_MS,
            'feed_saved_status'
          );
        } catch (annotateError) {
          console.warn('[tracker] annotateSavedStatus timed out/faulted:', annotateError.message || annotateError);
          return rawPageData.map((item) => ({ ...item, saved: Boolean(item?.saved), isRead: Boolean(item?.isRead) }));
        }
      },
    });
    const pageData = page.data;

    const fetchedAtIso = snapshot.fetchedAt
      ? new Date(snapshot.fetchedAt).toISOString()
      : new Date(now).toISOString();

    res.json({
      data: pageData,
      cached: cacheSource !== 'live' && !debug,
      cacheSource,
      softStale,
      fetchedAt: fetchedAtIso,
      snapshotId,
      offset,
      limit,
      hasMore: page.hasMore,
      total: page.total,
      perSource: Array.isArray(snapshot.perSource) ? snapshot.perSource : [],
      sourceCount: Number(snapshot.sourceCount || 0) || 0,
      refreshInProgress: feedRefreshRunning,
      staleRunTriggered,
      shuffled,
      rankingMode,
      ...(debug ? { rankingProfile } : {}),
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

// POST /api/tracker/events — tracker interaction events for personalization
router.post('/events', optionalAuth, async (req, res) => {
  try {
    const rawEvents = Array.isArray(req.body?.events)
      ? req.body.events
      : [req.body];
    const capped = rawEvents.slice(0, 200);
    const events = capped
      .map((entry) => normalizeTrackerEventPayload(entry))
      .filter(Boolean);
    if (events.length === 0) {
      return res.status(400).json({ error: 'No valid tracker events provided' });
    }
    const userId = getTrackerEventUserId(req, req.body || {});
    if (!userId) {
      return res.json({ ok: true, stored: 0, ignored: 'missing_user_identity' });
    }
    const stored = await saveTrackerEvents(userId, events);
    userFeedProfileCache.delete(userId);
    return res.json({ ok: true, stored });
  } catch (e) {
    console.error('[tracker] POST /events error:', e);
    return res.status(500).json({ error: e.message || 'Failed to record tracker events' });
  }
});

// POST /api/tracker/feed/invalidate — force feed cache refresh (auth required)
router.post('/feed/invalidate', requireAuth, (req, res) => {
  (async () => {
    await invalidateFeedCache('invalidate');
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

// GET /api/tracker/sources/audit — recent source change history (auth required)
router.get('/sources/audit', requireAuth, async (req, res) => {
  try {
    const parsedLimit = parseInt(req.query.limit || '200', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 1000)) : 200;
    const parsedSourceId = parseInt(req.query.sourceId || '', 10);
    const hasSourceId = Number.isFinite(parsedSourceId) && parsedSourceId > 0;
    const db = getDb();
    const result = hasSourceId
      ? await db.execute({
        sql: `
          SELECT id, source_id, op, type, name, config, enabled, captured_at
          FROM tracker_sources_audit
          WHERE source_id = ?
          ORDER BY id DESC
          LIMIT ?
        `,
        args: [parsedSourceId, limit],
      })
      : await db.execute({
        sql: `
          SELECT id, source_id, op, type, name, config, enabled, captured_at
          FROM tracker_sources_audit
          ORDER BY id DESC
          LIMIT ?
        `,
        args: [limit],
      });
    const data = (result.rows || []).map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      op: row.op,
      type: row.type,
      name: row.name,
      config: safeParseJson(row.config, {}),
      enabled: Number(row.enabled || 0) === 1,
      capturedAt: row.captured_at,
    }));
    res.json({ data, total: data.length });
  } catch (e) {
    console.error('[tracker] GET /sources/audit error:', e);
    res.status(500).json({ error: e.message || 'Failed to load source audit history' });
  }
});

// POST /api/tracker/sources/reorder — reorder sources by drag priority
router.post('/sources/reorder', requireAuth, async (req, res) => {
  try {
    const sourceIds = Array.isArray(req.body?.sourceIds) ? req.body.sourceIds : [];
    if (sourceIds.length === 0) {
      return res.status(400).json({ error: 'sourceIds (non-empty array) is required' });
    }
    const reordered = await paperTracker.reorderSources(sourceIds);
    await invalidateFeedCache('source_reorder');
    res.json(reordered.map((source) => sanitizeSourceForResponse(source, true)));
  } catch (e) {
    console.error('[tracker] POST /sources/reorder error:', e);
    res.status(500).json({ error: e.message || 'Failed to reorder sources' });
  }
});

// POST /api/tracker/sources — add a new source
router.post('/sources', requireAuth, async (req, res) => {
  try {
    const { type, name, config } = req.body;
    if (!type || !name) {
      return res.status(400).json({ error: 'type and name are required' });
    }
    const normalizedType = normalizeTrackerSourceType(type);
    const validTypes = FEED_SUPPORTED_SOURCE_TYPES;
    if (!validTypes.includes(normalizedType)) {
      return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
    }
    const normalizedConfig = normalizeSourceConfig(normalizedType, config || {});
    const id = await paperTracker.addSource(normalizedType, name, normalizedConfig);
    await invalidateFeedCache('source_add');
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
      normalizedConfig = normalizeSourceConfig(normalizeTrackerSourceType(sourceType), config);
    }
    await paperTracker.updateSource(Number(id), { name, config: normalizedConfig, enabled });
    await invalidateFeedCache('source_update');
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
    await invalidateFeedCache('source_delete');
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

function parsePriorityWeight(config = {}) {
  const raw = parseInt(config?.priorityWeight ?? config?.weight ?? '', 10);
  if (!Number.isFinite(raw)) return null;
  return Math.max(-1000, Math.min(raw, 1000));
}

function withPriorityWeight(normalizedConfig = {}, originalConfig = {}) {
  const priorityWeight = parsePriorityWeight(originalConfig);
  if (!Number.isFinite(priorityWeight)) return normalizedConfig || {};
  return {
    ...(normalizedConfig || {}),
    priorityWeight,
  };
}

function normalizeSourceConfig(type, config) {
  const normalizedType = normalizeTrackerSourceType(type);
  if (normalizedType === 'twitter') return withPriorityWeight(normalizeTwitterConfig(config), config);
  if (normalizedType === 'finance') return withPriorityWeight(normalizeFinanceConfig(config), config);
  if (normalizedType === 'arxiv_authors') return withPriorityWeight(normalizeArxivAuthorsConfig(config), config);
  if (normalizedType === 'rss') return withPriorityWeight(normalizeRssConfig(config), config);
  return withPriorityWeight(config || {}, config);
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

function normalizeRssConfig(config = {}) {
  return rssTracker.normalizeConfig(config);
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
