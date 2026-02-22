/**
 * HuggingFace Daily Papers tracker
 * Polls https://huggingface.co/api/daily_papers for recent papers
 * Returns array of { arxivId, title, abstract, authors, publishedAt, upvotes }
 */

const MAX_LOOKBACK_DAYS = 10; // hard cap — never fetch more than 10 days
const REQUEST_DELAY_MS = 800; // pause between per-day requests (be polite)
const FETCH_TIMEOUT_MS = 15000; // 15s timeout per request

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch HuggingFace daily papers for a specific date
 * @param {string} dateStr - ISO date string YYYY-MM-DD
 */
async function fetchHfPapersForDate(dateStr) {
  const url = `https://huggingface.co/api/daily_papers?date=${dateStr}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'auto-researcher/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HuggingFace API error: HTTP ${response.status} for date ${dateStr}`);
    }
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch recent HuggingFace papers (last N days)
 * @param {Object} config - { minUpvotes, lookbackDays }
 * @returns {Promise<Array>} Array of paper objects
 */
async function getNewPapers(config = {}) {
  const { minUpvotes = 10 } = config;
  // Cap lookback to MAX_LOOKBACK_DAYS regardless of what's configured
  const lookbackDays = Math.min(Number(config.lookbackDays) || 7, MAX_LOOKBACK_DAYS);
  const allPapers = [];

  for (let i = 0; i < lookbackDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    try {
      const dayPapers = await fetchHfPapersForDate(dateStr);
      allPapers.push(...(dayPapers || []));
    } catch (e) {
      console.warn(`[HFTracker] Failed to fetch papers for ${dateStr}: ${e.message}`);
    }

    // Rate limit: pause between requests (skip delay after last day)
    if (i < lookbackDays - 1) await sleep(REQUEST_DELAY_MS);
  }

  // Normalize and filter
  const seen = new Set();
  const result = [];

  for (const entry of allPapers) {
    // HF API wraps paper under entry.paper
    const paper = entry.paper || entry;
    const arxivId = paper.id;
    if (!arxivId || seen.has(arxivId)) continue;
    seen.add(arxivId);

    const upvotes = paper.upvotes || entry.upvotes || 0;
    if (upvotes < minUpvotes) continue;

    result.push({
      arxivId,
      title: paper.title || '',
      abstract: paper.summary || paper.abstract || '',
      authors: Array.isArray(paper.authors)
        ? paper.authors.map((a) => (typeof a === 'string' ? a : a.name || '')).filter(Boolean)
        : [],
      publishedAt: paper.publishedAt || paper.published_at || '',
      upvotes,
    });
  }

  return result;
}

module.exports = { getNewPapers };
