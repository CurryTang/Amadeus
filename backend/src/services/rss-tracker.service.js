/**
 * Generic RSS/Atom Tracker
 *
 * Tracks arbitrary blog/news feeds and returns normalized article items.
 */

const DEFAULT_MAX_ITEMS_PER_FEED = 20;
const MAX_ITEMS_PER_FEED_CAP = 80;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_LOOKBACK_DAYS = 180;
const MAX_LOOKBACK_DAYS = 3650;

function decodeXmlEntities(input = '') {
  return String(input)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/');
}

function stripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function clipText(input = '', max = 700) {
  const text = String(input || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trim()}…`;
}

function normalizeDate(raw) {
  if (!raw) return '';
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString();
}

function parseFeedUrls(input) {
  const raw = Array.isArray(input)
    ? input.flatMap((v) => String(v || '').split(/[\n,]+/))
    : String(input || '').split(/[\n,]+/);

  const seen = new Set();
  const urls = [];
  for (const token of raw) {
    const value = String(token || '').trim();
    if (!value || seen.has(value)) continue;
    try {
      const parsed = new URL(value);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      seen.add(parsed.toString());
      urls.push(parsed.toString());
    } catch (_) {
      // Ignore malformed URLs.
    }
  }
  return urls;
}

function normalizeConfig(config = {}) {
  const feedUrls = parseFeedUrls(config.feedUrls || config.feedUrlsText || config.url || config.urls || '');
  if (feedUrls.length === 0) {
    throw new Error('RSS tracker requires at least one valid feed URL');
  }

  const maxRaw = parseInt(config.maxItemsPerFeed || DEFAULT_MAX_ITEMS_PER_FEED, 10);
  const maxItemsPerFeed = Number.isFinite(maxRaw)
    ? Math.max(1, Math.min(maxRaw, MAX_ITEMS_PER_FEED_CAP))
    : DEFAULT_MAX_ITEMS_PER_FEED;

  const timeoutRaw = parseInt(config.timeoutMs || DEFAULT_TIMEOUT_MS, 10);
  const timeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(3000, Math.min(timeoutRaw, 45000))
    : DEFAULT_TIMEOUT_MS;
  const lookbackRaw = parseInt(config.lookbackDays ?? config.maxAgeDays ?? DEFAULT_LOOKBACK_DAYS, 10);
  const lookbackDays = Number.isFinite(lookbackRaw)
    ? Math.max(1, Math.min(lookbackRaw, MAX_LOOKBACK_DAYS))
    : DEFAULT_LOOKBACK_DAYS;

  return {
    feedUrls,
    maxItemsPerFeed,
    timeoutMs,
    lookbackDays,
  };
}

async function fetchFeedXml(url, timeoutMs) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'auto-researcher/1.0',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/plain, */*',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} ${body.slice(0, 140)}`.trim());
  }

  const xml = await response.text();
  if (!/<rss[\s>]|<feed[\s>]/i.test(xml)) {
    throw new Error(`Not a valid RSS/Atom feed: ${url}`);
  }
  return xml;
}

async function fetchItemsViaRss2Json(feedUrl, timeoutMs, maxItemsPerFeed) {
  const endpoint = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
  const response = await fetch(endpoint, {
    headers: {
      'User-Agent': 'auto-researcher/1.0',
      Accept: 'application/json,text/plain,*/*',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`rss2json HTTP ${response.status} ${body.slice(0, 140)}`.trim());
  }
  const payload = await response.json();
  if (String(payload?.status || '').toLowerCase() !== 'ok' || !Array.isArray(payload?.items)) {
    throw new Error('rss2json returned invalid payload');
  }
  const feedTitle = String(payload?.feed?.title || '').trim() || feedUrl;
  const items = payload.items.slice(0, maxItemsPerFeed).map((entry) => ({
    title: stripHtml(String(entry?.title || '').trim()),
    link: String(entry?.link || '').trim(),
    id: String(entry?.guid || entry?.link || '').trim(),
    summary: String(entry?.description || '').trim(),
    author: String(entry?.author || '').trim(),
    publishedAt: String(entry?.pubDate || '').trim(),
  }));
  return { feedTitle, items };
}

function parseAttributes(raw = '') {
  const attrs = {};
  const pattern = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    attrs[String(match[1] || '').toLowerCase()] = decodeXmlEntities(match[2] || '');
  }
  return attrs;
}

function extractTagValue(xml = '', tags = []) {
  for (const tag of tags) {
    const escaped = String(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cdata = new RegExp(`<${escaped}\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${escaped}>`, 'i');
    const plain = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const cdataMatch = xml.match(cdata);
    if (cdataMatch?.[1]) return decodeXmlEntities(cdataMatch[1]).trim();
    const plainMatch = xml.match(plain);
    if (plainMatch?.[1]) return decodeXmlEntities(plainMatch[1]).trim();
  }
  return '';
}

function extractLink(xml = '', fallback = '') {
  // Atom style: <link href="..."/>
  const atomLink = xml.match(/<link\b([^>]*)\/?>/i);
  if (atomLink?.[1]) {
    const attrs = parseAttributes(atomLink[1]);
    if (attrs.href) return String(attrs.href).trim();
  }

  // RSS style: <link>https://...</link>
  const rssLink = extractTagValue(xml, ['link']);
  if (rssLink) return rssLink;
  return fallback;
}

function parseRssItems(xml = '') {
  const items = [];
  const itemPattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemPattern.exec(xml)) !== null) {
    const itemXml = match[1] || '';
    items.push({
      title: stripHtml(extractTagValue(itemXml, ['title'])),
      link: extractLink(itemXml),
      id: extractTagValue(itemXml, ['guid', 'id']),
      summary: extractTagValue(itemXml, ['description', 'content:encoded', 'content']),
      author: extractTagValue(itemXml, ['dc:creator', 'author']),
      publishedAt: extractTagValue(itemXml, ['pubDate', 'published', 'updated', 'dc:date']),
    });
  }
  return items;
}

function parseAtomEntries(xml = '') {
  const entries = [];
  const entryPattern = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryPattern.exec(xml)) !== null) {
    const entryXml = match[1] || '';
    entries.push({
      title: stripHtml(extractTagValue(entryXml, ['title'])),
      link: extractLink(entryXml),
      id: extractTagValue(entryXml, ['id']),
      summary: extractTagValue(entryXml, ['summary', 'content']),
      author: extractTagValue(entryXml, ['author', 'name', 'dc:creator']),
      publishedAt: extractTagValue(entryXml, ['published', 'updated']),
    });
  }
  return entries;
}

function parseFeedTitle(xml = '') {
  const channelMatch = xml.match(/<channel\b[^>]*>([\s\S]*?)<\/channel>/i);
  if (channelMatch?.[1]) {
    const title = stripHtml(extractTagValue(channelMatch[1], ['title']));
    if (title) return title;
  }
  return stripHtml(extractTagValue(xml, ['title']));
}

function parseFeed(xml = '') {
  const feedTitle = parseFeedTitle(xml);
  if (/<item\b/i.test(xml)) {
    return { feedTitle, items: parseRssItems(xml) };
  }
  if (/<entry\b/i.test(xml)) {
    return { feedTitle, items: parseAtomEntries(xml) };
  }
  return { feedTitle, items: [] };
}

function toExternalId(feedUrl, item) {
  const idCore = String(item.id || item.link || `${item.title}:${item.publishedAt}`).trim();
  return `${feedUrl}::${idCore}`;
}

async function getLatestItems(rawConfig = {}) {
  const config = normalizeConfig(rawConfig);
  const merged = [];
  const seenIds = new Set();
  const cutoffMs = Date.now() - (config.lookbackDays * 24 * 60 * 60 * 1000);

  for (const feedUrl of config.feedUrls) {
    try {
      let parsed = null;
      try {
        // eslint-disable-next-line no-await-in-loop
        const xml = await fetchFeedXml(feedUrl, config.timeoutMs);
        parsed = parseFeed(xml);
      } catch (directError) {
        // Some feeds are region-restricted from certain nodes.
        // rss2json is a lightweight fallback that keeps ingestion resilient.
        // eslint-disable-next-line no-await-in-loop
        parsed = await fetchItemsViaRss2Json(feedUrl, config.timeoutMs, config.maxItemsPerFeed);
        console.log(`[RssTracker] rss2json fallback used for ${feedUrl}: ${directError.message}`);
      }
      const feedTitle = parsed.feedTitle || feedUrl;
      const entries = Array.isArray(parsed.items) ? parsed.items.slice(0, config.maxItemsPerFeed) : [];

      for (const entry of entries) {
        const title = String(entry.title || '').trim();
        if (!title) continue;

        const link = String(entry.link || '').trim();
        const externalId = toExternalId(feedUrl, entry);
        if (!externalId || seenIds.has(externalId)) continue;
        seenIds.add(externalId);

        merged.push({
          externalId,
          title,
          url: link,
          summary: clipText(stripHtml(entry.summary || ''), 700),
          author: String(entry.author || '').trim(),
          publishedAt: normalizeDate(entry.publishedAt),
          feedUrl,
          feedTitle,
        });
      }
    } catch (error) {
      console.warn(`[RssTracker] Failed feed ${feedUrl}: ${error.message}`);
    }
  }

  merged.sort((a, b) => {
    const ta = new Date(a.publishedAt || 0).getTime() || 0;
    const tb = new Date(b.publishedAt || 0).getTime() || 0;
    if (tb !== ta) return tb - ta;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });

  return merged.filter((item) => {
    const ts = new Date(item.publishedAt || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) return false;
    return ts >= cutoffMs;
  });
}

module.exports = {
  normalizeConfig,
  getLatestItems,
};
