/**
 * Experimental Twitter/X tracker using Playwright.
 *
 * Supports tracking multiple profile links and extracting latest posts
 * under a configurable tracking mode.
 *
 * Current supported mode:
 * - paper: detect paper-related links (arXiv/DOI/OpenReview/etc.) and arXiv IDs
 *
 * Future modes (finance/web3/...) can plug into mode classifiers without
 * changing crawler orchestration.
 */

const fs = require('fs');
// Lazy-require playwright so the server starts without it installed.
// Only resolved when extractLatestPosts() is actually called.
let chromium;
const {
  extractTwitterHandle,
  normalizeTwitterProfileLinks,
} = require('../utils/twitter-profile-links');

const ARXIV_URL_PATTERN = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi;
const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const PAPER_MODE_LINK_PATTERNS = [
  /(?:^|\.)arxiv\.org$/i,
  /(?:^|\.)openreview\.net$/i,
  /(?:^|\.)doi\.org$/i,
  /(?:^|\.)aclweb\.org$/i,
  /(?:^|\.)aclanthology\.org$/i,
  /(?:^|\.)proceedings\.mlr\.press$/i,
  /(?:^|\.)papers\.nips\.cc$/i,
  /(?:^|\.)dl\.acm\.org$/i,
  /(?:^|\.)ieeexplore\.ieee\.org$/i,
  /(?:^|\.)link\.springer\.com$/i,
  /(?:^|\.)nature\.com$/i,
  /(?:^|\.)science\.org$/i,
  /(?:^|\.)ssrn\.com$/i,
  /(?:^|\.)biorxiv\.org$/i,
  /(?:^|\.)medrxiv\.org$/i,
];

const DEFAULT_MAX_POSTS_PER_PROFILE = 15;
const MAX_POSTS_PER_PROFILE_CAP = 50;
const SUPPORTED_TRACKING_MODES = ['paper'];

function normalizeTrackingMode(mode) {
  return String(mode || 'paper').trim().toLowerCase() || 'paper';
}

function normalizeArxivId(id) {
  return id.replace(/v\d+$/, '');
}

function extractArxivIdsFromText(text) {
  if (!text) return [];
  const ids = new Set();
  let match;
  const pattern = new RegExp(ARXIV_URL_PATTERN.source, 'gi');
  while ((match = pattern.exec(text)) !== null) {
    ids.add(normalizeArxivId(match[1]));
  }
  return [...ids];
}

function extractUrlsFromText(text) {
  if (!text) return [];
  const urls = [];
  let match;
  const pattern = new RegExp(URL_PATTERN.source, 'gi');
  while ((match = pattern.exec(text)) !== null) {
    urls.push(match[0].replace(/[.,;!?]+$/, ''));
  }
  return urls;
}

function isLikelyPaperUrl(input) {
  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    return PAPER_MODE_LINK_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch (_) {
    return false;
  }
}

function detectPaperModeSignals(textBlob, links) {
  const paperLinks = links.filter(isLikelyPaperUrl);
  const arxivIds = new Set();
  for (const arxivId of extractArxivIdsFromText(textBlob)) {
    arxivIds.add(arxivId);
  }
  return {
    matchedLinks: paperLinks,
    entities: { arxivIds: [...arxivIds] },
  };
}

function detectModeSignals(trackingMode, textBlob, links) {
  switch (trackingMode) {
    case 'paper':
      return detectPaperModeSignals(textBlob, links);
    default:
      return {
        matchedLinks: [],
        entities: {},
      };
  }
}

function hasModeMatches(post, trackingMode) {
  switch (trackingMode) {
    case 'paper':
      return (post.paperLinks?.length || 0) > 0 || (post.arxivIds?.length || 0) > 0;
    default:
      return (post.matchedLinks?.length || 0) > 0;
  }
}

async function resolveUrl(input) {
  if (!input) return input;
  let url;
  try {
    url = new URL(input);
  } catch (_) {
    return input;
  }

  const needsResolution = ['t.co', 'bit.ly', 'tinyurl.com'].includes(url.hostname.toLowerCase());
  if (!needsResolution) return input;

  try {
    const response = await fetch(input, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    return response.url || input;
  } catch (_) {
    return input;
  }
}

function buildTrackerConfig(config = {}) {
  const mode = String(config.mode || 'playwright').toLowerCase();
  if (mode !== 'playwright') {
    throw new Error('twitter-playwright tracker requires mode=playwright');
  }
  const trackingMode = normalizeTrackingMode(config.trackingMode || config.topicMode || 'paper');
  if (!SUPPORTED_TRACKING_MODES.includes(trackingMode)) {
    throw new Error(
      `twitter-playwright tracker mode "${trackingMode}" is not supported yet. ` +
      `Supported modes: ${SUPPORTED_TRACKING_MODES.join(', ')}`
    );
  }

  const linksSource = config.profileLinks || config.profileLinksText || config.links || [];
  const { normalized: profileLinks, invalid } = normalizeTwitterProfileLinks(linksSource);

  const maxParsed = parseInt(config.maxPostsPerProfile || DEFAULT_MAX_POSTS_PER_PROFILE, 10);
  const maxPostsPerProfile = Number.isFinite(maxParsed)
    ? Math.max(1, Math.min(maxParsed, MAX_POSTS_PER_PROFILE_CAP))
    : DEFAULT_MAX_POSTS_PER_PROFILE;

  const onlyWithModeMatches = config.onlyWithModeMatches === true ||
    (trackingMode === 'paper' && config.onlyWithPaperLinks === true);

  return {
    profileLinks,
    invalidProfileLinks: invalid,
    maxPostsPerProfile,
    trackingMode,
    onlyWithModeMatches,
    // Backward compatibility: keep the old field for existing callers.
    onlyWithPaperLinks: trackingMode === 'paper' ? onlyWithModeMatches : false,
    headless: config.headless !== false,
    storageStatePath: config.storageStatePath || process.env.X_PLAYWRIGHT_STORAGE_STATE_PATH || '',
  };
}

function sanitizePostLinks(post) {
  const filtered = (post.links || []).filter((href) => {
    try {
      const url = new URL(href);
      const host = url.hostname.toLowerCase();
      if (host.endsWith('x.com') || host.endsWith('twitter.com')) return false;
      return true;
    } catch (_) {
      return false;
    }
  });
  return [...new Set(filtered)];
}

async function extractPostsFromProfile(page, profileUrl, maxPostsPerProfile) {
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1800);

  const posts = new Map();
  let stagnantRounds = 0;

  for (let i = 0; i < 12; i++) {
    const beforeCount = posts.size;
    const visible = await page.$$eval('article[data-testid="tweet"]', (articles) => {
      return articles.map((article) => {
        const textNode = article.querySelector('[data-testid="tweetText"]');
        const text = textNode ? textNode.innerText.trim() : '';
        const timeNode = article.querySelector('time');
        const postedAt = timeNode ? (timeNode.getAttribute('datetime') || '') : '';
        const statusAnchor =
          (timeNode && timeNode.closest('a')) ||
          article.querySelector('a[href*="/status/"]');
        const postUrl = statusAnchor ? statusAnchor.href : '';
        const links = Array.from(article.querySelectorAll('a[href]'))
          .map((a) => a.href)
          .filter(Boolean);
        return { text, postedAt, postUrl, links };
      });
    });

    for (const post of visible) {
      if (!post.postUrl || posts.has(post.postUrl)) continue;
      posts.set(post.postUrl, post);
      if (posts.size >= maxPostsPerProfile) break;
    }

    if (posts.size >= maxPostsPerProfile) break;

    if (posts.size === beforeCount) stagnantRounds += 1;
    else stagnantRounds = 0;
    if (stagnantRounds >= 2) break;

    await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.92)));
    await page.waitForTimeout(1200);
  }

  return [...posts.values()].slice(0, maxPostsPerProfile);
}

async function enrichPost(post, handle, trackingMode) {
  const rawLinks = [
    ...sanitizePostLinks(post),
    ...extractUrlsFromText(post.text || ''),
  ];
  const dedupedLinks = [...new Set(rawLinks)];
  const resolvedLinks = [];

  for (const link of dedupedLinks) {
    const resolved = await resolveUrl(link);
    resolvedLinks.push(resolved);
  }

  const uniqueResolved = [...new Set(resolvedLinks)];
  const textBlob = `${post.text || ''} ${uniqueResolved.join(' ')}`;
  const modeSignals = detectModeSignals(trackingMode, textBlob, uniqueResolved);
  const matchedLinks = modeSignals.matchedLinks || [];
  const entities = modeSignals.entities || {};
  const arxivIds = Array.isArray(entities.arxivIds) ? entities.arxivIds : [];

  return {
    trackingMode,
    influencerHandle: handle,
    postUrl: post.postUrl,
    postedAt: post.postedAt || null,
    postText: post.text || '',
    postTextSnippet: (post.text || '').slice(0, 220),
    matchedLinks,
    entities,
    // Backward compatibility fields used by paper tracker today.
    paperLinks: trackingMode === 'paper' ? matchedLinks : [],
    allLinks: uniqueResolved,
    arxivIds,
  };
}

async function extractLatestPosts(config = {}) {
  const trackerConfig = buildTrackerConfig(config);
  const {
    profileLinks,
    maxPostsPerProfile,
    trackingMode,
    onlyWithModeMatches,
    headless,
    storageStatePath,
  } = trackerConfig;

  if (profileLinks.length === 0) {
    throw new Error('Playwright Twitter tracker requires at least one valid profile link');
  }

  if (trackerConfig.invalidProfileLinks.length > 0) {
    console.warn(
      `[TwitterPlaywrightTracker] Ignoring invalid profile links: ${trackerConfig.invalidProfileLinks.join(', ')}`
    );
  }

  const contextOptions = {};
  if (storageStatePath && fs.existsSync(storageStatePath)) {
    contextOptions.storageState = storageStatePath;
  }

  if (!chromium) {
    try {
      chromium = require('playwright').chromium;
    } catch {
      throw new Error('playwright is not installed. Run: npm install playwright && npx playwright install chromium');
    }
  }

  const browser = await chromium.launch({ headless });

  try {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.setExtraHTTPHeaders({
      'accept-language': 'en-US,en;q=0.9',
    });

    const allPosts = [];
    for (const profileUrl of profileLinks) {
      const handle = extractTwitterHandle(profileUrl) || profileUrl;
      try {
        const rawPosts = await extractPostsFromProfile(page, profileUrl, maxPostsPerProfile);
        for (const post of rawPosts) {
          allPosts.push(await enrichPost(post, handle, trackingMode));
        }
        console.log(`[TwitterPlaywrightTracker] @${handle}: scanned ${rawPosts.length} posts`);
      } catch (error) {
        console.error(`[TwitterPlaywrightTracker] Failed profile ${profileUrl}: ${error.message}`);
      }
    }

    const filtered = onlyWithModeMatches
      ? allPosts.filter((p) => hasModeMatches(p, trackingMode))
      : allPosts;

    return {
      mode: 'playwright',
      trackingMode,
      totalProfiles: profileLinks.length,
      totalPosts: filtered.length,
      posts: filtered,
    };
  } finally {
    await browser.close();
  }
}

async function getNewPapers(config = {}) {
  const result = await extractLatestPosts(config);
  if (result.trackingMode !== 'paper') {
    throw new Error(
      `getNewPapers only supports trackingMode=\"paper\" right now (got \"${result.trackingMode}\")`
    );
  }
  const papers = [];
  const seenArxiv = new Set();

  for (const post of result.posts) {
    for (const arxivId of post.arxivIds || []) {
      if (seenArxiv.has(arxivId)) continue;
      seenArxiv.add(arxivId);
      papers.push({
        arxivId,
        tweetUrl: post.postUrl,
        tweetText: post.postTextSnippet,
        influencerHandle: post.influencerHandle,
      });
    }
  }

  return papers;
}

module.exports = {
  SUPPORTED_TRACKING_MODES,
  normalizeTrackingMode,
  buildTrackerConfig,
  // Generic extractor for mode-based tracking.
  extractLatestPosts,
  // Backward compatibility alias.
  extractLatestPaperPosts: extractLatestPosts,
  getNewPapers,
};
