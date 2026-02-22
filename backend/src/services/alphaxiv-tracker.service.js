/**
 * AlphaXiv Tracker
 *
 * Fetches papers from alphaxiv.org — a community platform layered on top of
 * arXiv that tracks paper views, votes, and discussions. Supports filtering
 * by arXiv category and minimum view count.
 *
 * API: https://api.alphaxiv.org/papers/v3/feed
 *
 * Config fields:
 *   categories  - string or array of arXiv category codes, e.g. "cs.LG,cs.AI"
 *   interval    - time window: "3 Days" | "7 Days" | "30 Days" | "90 Days" (default: "7 Days")
 *   minViews    - only import papers with at least this many total views (default: 0)
 *   sortBy      - "Views" | "Hot" | "Likes" | "GitHub" | "Comments" (default: "Views")
 */

const FETCH_TIMEOUT_MS = 20000; // 20s — AlphaXiv can be slow

const VALID_INTERVALS = ['3 Days', '7 Days', '30 Days', '90 Days', 'All time'];
const VALID_SORTS = ['Views', 'Hot', 'Likes', 'GitHub', 'Comments'];

const POPULAR_CATEGORIES = [
  'cs.AI', 'cs.LG', 'cs.CV', 'cs.CL', 'cs.RO',
  'stat.ML', 'cs.NE', 'cs.IR', 'cs.CR', 'cs.HC',
];

function parseCategories(categories) {
  if (!categories) return ['cs.LG'];
  if (Array.isArray(categories)) return categories.map(String).filter(Boolean);
  return String(categories).split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Fetch trending papers from alphaxiv.org filtered by categories.
 * @param {Object} config - { categories, interval, minViews, sortBy }
 * @returns {Promise<Array>} Array of { arxivId, title, abstract, authors, publishedAt, primaryCategory, views }
 */
async function getNewPapers(config = {}) {
  const {
    interval = '7 Days',
    minViews = 0,
    sortBy = 'Views',
  } = config;

  const cats = parseCategories(config.categories);
  const safeInterval = VALID_INTERVALS.includes(interval) ? interval : '7 Days';
  const safeSort = VALID_SORTS.includes(sortBy) ? sortBy : 'Views';

  const params = new URLSearchParams({
    pageNum: '1',
    pageSize: '100',
    sort: safeSort,
    interval: safeInterval,
    topics: JSON.stringify(cats),
  });

  const url = `https://api.alphaxiv.org/papers/v3/feed?${params}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'auto-researcher/1.0',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`AlphaXiv API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const papers = data.papers || [];

  const seen = new Set();
  const results = [];

  for (const paper of papers) {
    // universal_paper_id is the clean arXiv ID (e.g. "2602.13949")
    const arxivId = paper.universal_paper_id
      || paper.canonical_id?.replace(/v\d+$/, '');
    if (!arxivId || seen.has(arxivId)) continue;

    const views = paper.metrics?.visits_count?.all || 0;
    if (views < Number(minViews || 0)) continue;

    seen.add(arxivId);

    // Primary category is the first arXiv-style code in the topics array
    const primaryCategory = (paper.topics || []).find((t) => /^[a-z-]+\.[A-Z]+$/.test(t)) || '';

    results.push({
      arxivId,
      title: paper.title || `arXiv:${arxivId}`,
      abstract: paper.abstract || '',
      authors: paper.authors || [],
      publishedAt: paper.first_publication_date || paper.publication_date || '',
      primaryCategory,
      views,
    });
  }

  return results;
}

module.exports = { getNewPapers, POPULAR_CATEGORIES, VALID_INTERVALS, VALID_SORTS };
