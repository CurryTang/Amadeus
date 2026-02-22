/**
 * Twitter/X paper tracker using Nitter RSS feeds (free, no API key required)
 * Nitter is an open-source Twitter frontend that provides RSS feeds.
 *
 * Config: { username, nitterInstance }
 *   username        - Twitter username to track (e.g. "karpathy")
 *   nitterInstance  - Optional: custom nitter instance URL (default: tries list of public instances)
 *
 * Falls back through multiple nitter instances if one is unavailable.
 */

// Public nitter instances — ordered by reliability
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
  'https://nitter.kavin.rocks',
];

const ARXIV_PATTERN = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/gi;
const ARXIV_ID_PATTERN = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i;

function extractArxivIdsFromText(text) {
  const ids = new Set();
  let m;
  const pattern = new RegExp(ARXIV_PATTERN.source, 'gi');
  while ((m = pattern.exec(text)) !== null) {
    ids.add(m[1].replace(/v\d+$/, ''));
  }
  return [...ids];
}

/**
 * Fetch Nitter RSS for a Twitter username
 * @param {string} username
 * @param {string} instanceUrl
 */
async function fetchNitterRss(username, instanceUrl) {
  const url = `${instanceUrl}/${username}/rss`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'auto-researcher/1.0',
      'Accept': 'application/rss+xml, application/xml, text/xml',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Nitter RSS HTTP ${response.status} from ${instanceUrl}`);
  }

  const text = await response.text();
  if (!text.includes('<rss') && !text.includes('<feed')) {
    throw new Error(`Not a valid RSS feed from ${instanceUrl}`);
  }

  return text;
}

/**
 * Parse RSS XML and extract tweet items with their text
 * Simple regex-based parsing to avoid XML parser dependency.
 */
function parseRssItems(xml) {
  const items = [];
  // Match <item> blocks
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemPattern.exec(xml)) !== null) {
    const itemXml = m[1];

    // Extract title (tweet text, often truncated)
    const titleM = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                   itemXml.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleM ? titleM[1].trim() : '';

    // Extract description (full tweet HTML)
    const descM = itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                  itemXml.match(/<description>([\s\S]*?)<\/description>/);
    const desc = descM ? descM[1].trim() : '';

    // Extract link
    const linkM = itemXml.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkM ? linkM[1].trim() : '';

    // Extract date
    const dateM = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const date = dateM ? dateM[1].trim() : '';

    items.push({ title, description: desc, link, date });
  }
  return items;
}

/**
 * Strip HTML tags from a string
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fetch papers from a Twitter user's recent tweets via Nitter RSS
 * @param {Object} config - { username, nitterInstance }
 * @returns {Promise<Array>} Array of { arxivId, tweetUrl, tweetText }
 */
async function getNewPapers(config = {}) {
  const { username, nitterInstance } = config;

  if (!username) {
    throw new Error('Twitter tracker requires a username in config');
  }

  const instances = nitterInstance
    ? [nitterInstance, ...NITTER_INSTANCES]
    : NITTER_INSTANCES;

  let xml = null;
  let lastError = null;

  for (const instance of instances) {
    try {
      xml = await fetchNitterRss(username, instance);
      console.log(`[TwitterTracker] Fetched RSS for @${username} from ${instance}`);
      break;
    } catch (e) {
      console.warn(`[TwitterTracker] Instance ${instance} failed: ${e.message}`);
      lastError = e;
    }
  }

  if (!xml) {
    throw new Error(`[TwitterTracker] All nitter instances failed for @${username}. Last error: ${lastError?.message}`);
  }

  const items = parseRssItems(xml);
  const papers = [];
  const seen = new Set();

  for (const item of items) {
    // Combine title + description for URL search
    const fullText = `${item.title} ${stripHtml(item.description)} ${item.link}`;
    const arxivIds = extractArxivIdsFromText(fullText);

    for (const arxivId of arxivIds) {
      if (seen.has(arxivId)) continue;
      seen.add(arxivId);
      papers.push({
        arxivId,
        tweetUrl: item.link,
        tweetText: item.title,
      });
    }
  }

  return papers;
}

module.exports = { getNewPapers };
