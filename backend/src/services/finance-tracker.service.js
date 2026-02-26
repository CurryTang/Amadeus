/**
 * Finance Tracker
 *
 * Supported providers:
 * - yahoo_rss             (free, no key)          : Yahoo RSS by symbol
 * - finnhub               (free tier, API key)    : company news by symbol
 * - alpha_vantage         (free tier, API key)    : NEWS_SENTIMENT by ticker
 * - polygon               (free tier, API key)    : ticker news
 * - eastmoney_cn          (free, no key)          : China market index snapshots
 * - cryptocompare_crypto  (free, no key)          : crypto-specific news feed
 */

const SUPPORTED_PROVIDERS = [
  'yahoo_rss',
  'finnhub',
  'alpha_vantage',
  'polygon',
  'eastmoney_cn',
  'cryptocompare_crypto',
];

const DEFAULT_PROVIDER = 'yahoo_rss';
const DEFAULT_REGION = 'US';
const DEFAULT_LANG = 'en-US';
const DEFAULT_MAX_ITEMS_PER_SYMBOL = 8;
const MAX_ITEMS_PER_SYMBOL_CAP = 30;
const FETCH_TIMEOUT_MS = 15000;
const SYMBOL_PATTERN = /^[A-Za-z0-9.^_\-=:]{1,40}$/;
const CN_SECID_PATTERN = /^[01]\.\d{6}$/;
const DEFAULT_CN_SECIDS = ['1.000001', '0.399001', '0.399006'];

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

function clipText(input = '', max = 600) {
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

function parseAlphaTimestamp(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!match) return normalizeDate(value);
  const [, y, m, d, hh, mm, ss] = match;
  return normalizeDate(`${y}-${m}-${d}T${hh}:${mm}:${ss}Z`);
}

function parseSymbols(input) {
  const raw = Array.isArray(input)
    ? input.flatMap((v) => String(v || '').split(/[\n,\s]+/))
    : String(input || '').split(/[\n,\s]+/);

  const seen = new Set();
  const symbols = [];
  for (const token of raw) {
    const symbol = token.trim().toUpperCase();
    if (!symbol || !SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
  }
  return symbols;
}

function normalizeCnSecid(raw) {
  const input = String(raw || '').trim().toLowerCase();
  if (!input) return '';
  if (CN_SECID_PATTERN.test(input)) return input;

  const prefixed = input.match(/^(sh|sz)(\d{6})$/i);
  if (prefixed) {
    const market = prefixed[1].toLowerCase() === 'sh' ? '1' : '0';
    return `${market}.${prefixed[2]}`;
  }

  return '';
}

function parseCnSecids(input) {
  const raw = Array.isArray(input)
    ? input.flatMap((v) => String(v || '').split(/[\n,\s]+/))
    : String(input || '').split(/[\n,\s]+/);

  const seen = new Set();
  const secids = [];
  for (const token of raw) {
    const secid = normalizeCnSecid(token);
    if (!secid || seen.has(secid)) continue;
    seen.add(secid);
    secids.push(secid);
  }
  return secids;
}

function parseRssItems(xml = '') {
  const items = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemPattern.exec(xml)) !== null) {
    const itemXml = match[1] || '';
    const titleMatch = itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)
      || itemXml.match(/<title>([\s\S]*?)<\/title>/i);
    const descMatch = itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)
      || itemXml.match(/<description>([\s\S]*?)<\/description>/i);
    const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);
    const dateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    items.push({
      title: decodeXmlEntities((titleMatch && titleMatch[1]) || '').trim(),
      description: decodeXmlEntities((descMatch && descMatch[1]) || '').trim(),
      url: decodeXmlEntities((linkMatch && linkMatch[1]) || '').trim(),
      publishedAt: normalizeDate((dateMatch && dateMatch[1]) || ''),
    });
  }

  return items;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'auto-researcher/1.0',
      Accept: 'application/json,text/plain,*/*',
      ...headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} ${body.slice(0, 140)}`.trim());
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error(`Invalid JSON response for ${url}`);
  }
}

async function fetchText(url, headers = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'auto-researcher/1.0',
      Accept: 'application/rss+xml, application/xml, text/xml, text/plain, */*',
      ...headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url} ${body.slice(0, 140)}`.trim());
  }

  return response.text();
}

function getProviderApiKey(provider, config = {}) {
  const inline = String(config.apiKey || '').trim();
  if (inline) return inline;

  if (provider === 'finnhub') return String(process.env.FINNHUB_API_KEY || '').trim();
  if (provider === 'alpha_vantage') return String(process.env.ALPHA_VANTAGE_API_KEY || '').trim();
  if (provider === 'polygon') return String(process.env.POLYGON_API_KEY || '').trim();
  return '';
}

function normalizeConfig(config = {}) {
  const provider = String(config.provider || DEFAULT_PROVIDER).trim().toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(`Finance provider must be one of: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }

  const maxRaw = parseInt(config.maxItemsPerSymbol || DEFAULT_MAX_ITEMS_PER_SYMBOL, 10);
  const maxItemsPerSymbol = Number.isFinite(maxRaw)
    ? Math.max(1, Math.min(maxRaw, MAX_ITEMS_PER_SYMBOL_CAP))
    : DEFAULT_MAX_ITEMS_PER_SYMBOL;

  const region = String(config.region || DEFAULT_REGION).trim() || DEFAULT_REGION;
  const lang = String(config.lang || DEFAULT_LANG).trim() || DEFAULT_LANG;

  const symbols = parseSymbols(config.symbols || config.symbolsText || config.tickers || '');
  const cnSecids = parseCnSecids(config.cnSecids || config.cnSecidsText || config.indices || '')
    || [];
  const categories = parseSymbols(config.categories || config.categoriesText || '').map((v) => v.toUpperCase());

  const lookbackRaw = parseInt(config.lookbackDays || '7', 10);
  const lookbackDays = Number.isFinite(lookbackRaw)
    ? Math.max(1, Math.min(lookbackRaw, 30))
    : 7;

  const apiKey = getProviderApiKey(provider, config);

  if (['yahoo_rss', 'finnhub', 'alpha_vantage', 'polygon'].includes(provider) && symbols.length === 0) {
    throw new Error(`${provider} requires at least one valid symbol`);
  }

  if (['finnhub', 'alpha_vantage', 'polygon'].includes(provider) && !apiKey) {
    throw new Error(`${provider} requires an API key (config.apiKey or environment variable)`);
  }

  return {
    provider,
    symbols,
    cnSecids: cnSecids.length > 0 ? cnSecids : DEFAULT_CN_SECIDS,
    categories,
    maxItemsPerSymbol,
    lookbackDays,
    region,
    lang,
    apiKey,
  };
}

function toExternalId(provider, symbol, rawId, url, title, publishedAt) {
  const core = String(rawId || url || `${title || ''}:${publishedAt || ''}`).trim();
  return `${provider}:${symbol ? `${symbol}:` : ''}${core}`;
}

function toStandardItem(provider, { externalId, symbol, title, url, summary, publishedAt }) {
  const normalizedTitle = String(title || '').trim();
  const normalizedSummary = clipText(stripHtml(summary || ''), 700);
  if (!normalizedTitle) return null;

  return {
    externalId: externalId || toExternalId(provider, symbol, '', url, normalizedTitle, publishedAt),
    symbol: String(symbol || '').toUpperCase(),
    title: normalizedTitle,
    url: String(url || '').trim(),
    summary: normalizedSummary,
    publishedAt: normalizeDate(publishedAt),
  };
}

async function fetchYahooItems(config) {
  const { symbols, region, lang, maxItemsPerSymbol } = config;
  const all = [];

  for (const symbol of symbols) {
    const params = new URLSearchParams({ s: symbol, region, lang });
    const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const xml = await fetchText(url);
    if (!xml.includes('<rss') && !xml.includes('<feed')) {
      throw new Error(`Invalid Yahoo RSS response for ${symbol}`);
    }
    if (/Will be right back/i.test(xml)) {
      throw new Error(`Yahoo feed temporarily unavailable for ${symbol}`);
    }

    const entries = parseRssItems(xml).slice(0, maxItemsPerSymbol);
    for (const entry of entries) {
      const item = toStandardItem('yahoo_rss', {
        externalId: toExternalId('yahoo_rss', symbol, '', entry.url, entry.title, entry.publishedAt),
        symbol,
        title: entry.title,
        url: entry.url,
        summary: entry.description,
        publishedAt: entry.publishedAt,
      });
      if (item) all.push(item);
    }
  }

  return all;
}

async function fetchFinnhubItems(config) {
  const { symbols, apiKey, maxItemsPerSymbol, lookbackDays } = config;
  const all = [];

  const toDate = new Date();
  const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const toIso = toDate.toISOString().slice(0, 10);
  const fromIso = fromDate.toISOString().slice(0, 10);

  for (const symbol of symbols) {
    const params = new URLSearchParams({
      symbol,
      from: fromIso,
      to: toIso,
      token: apiKey,
    });
    const url = `https://finnhub.io/api/v1/company-news?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(url);
    if (!Array.isArray(data)) {
      const errorMessage = data?.error || data?.message || 'Unexpected Finnhub response';
      throw new Error(`Finnhub: ${errorMessage}`);
    }

    const entries = data.slice(0, maxItemsPerSymbol);
    for (const entry of entries) {
      const item = toStandardItem('finnhub', {
        externalId: toExternalId('finnhub', symbol, entry.id || entry.datetime, entry.url, entry.headline, entry.datetime),
        symbol,
        title: entry.headline,
        url: entry.url,
        summary: entry.summary,
        publishedAt: entry.datetime ? new Date(Number(entry.datetime) * 1000).toISOString() : '',
      });
      if (item) all.push(item);
    }
  }

  return all;
}

async function fetchAlphaVantageItems(config) {
  const { symbols, apiKey, maxItemsPerSymbol } = config;
  const all = [];

  for (const symbol of symbols) {
    const params = new URLSearchParams({
      function: 'NEWS_SENTIMENT',
      tickers: symbol,
      limit: String(maxItemsPerSymbol),
      apikey: apiKey,
    });
    const url = `https://www.alphavantage.co/query?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(url);

    if (data?.ErrorMessage) {
      throw new Error(`Alpha Vantage: ${data.ErrorMessage}`);
    }
    if (data?.Information && !Array.isArray(data?.feed)) {
      throw new Error(`Alpha Vantage: ${data.Information}`);
    }

    const entries = Array.isArray(data?.feed) ? data.feed.slice(0, maxItemsPerSymbol) : [];
    for (const entry of entries) {
      const item = toStandardItem('alpha_vantage', {
        externalId: toExternalId('alpha_vantage', symbol, entry.id || entry.url, entry.url, entry.title, entry.time_published),
        symbol,
        title: entry.title,
        url: entry.url,
        summary: entry.summary,
        publishedAt: parseAlphaTimestamp(entry.time_published),
      });
      if (item) all.push(item);
    }
  }

  return all;
}

async function fetchPolygonItems(config) {
  const { symbols, apiKey, maxItemsPerSymbol } = config;
  const all = [];

  for (const symbol of symbols) {
    const params = new URLSearchParams({
      ticker: symbol,
      limit: String(maxItemsPerSymbol),
      sort: 'published_utc',
      order: 'desc',
      apiKey,
    });
    const url = `https://api.polygon.io/v2/reference/news?${params.toString()}`;
    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(url);

    if (data?.status === 'ERROR') {
      throw new Error(`Polygon: ${data.error || 'request failed'}`);
    }

    const entries = Array.isArray(data?.results) ? data.results.slice(0, maxItemsPerSymbol) : [];
    for (const entry of entries) {
      const item = toStandardItem('polygon', {
        externalId: toExternalId('polygon', symbol, entry.id || entry.article_url, entry.article_url, entry.title, entry.published_utc),
        symbol,
        title: entry.title,
        url: entry.article_url,
        summary: entry.description,
        publishedAt: entry.published_utc,
      });
      if (item) all.push(item);
    }
  }

  return all;
}

async function fetchCryptoCompareItems(config) {
  const { lang, categories, maxItemsPerSymbol } = config;
  const params = new URLSearchParams({
    lang: String(lang || 'EN').slice(0, 2).toUpperCase(),
  });
  if (categories.length > 0) {
    params.set('categories', categories.join(','));
  }

  const url = `https://min-api.cryptocompare.com/data/v2/news/?${params.toString()}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data?.Data)) {
    throw new Error(`CryptoCompare: ${data?.Message || 'unexpected response'}`);
  }

  return data.Data.slice(0, maxItemsPerSymbol).map((entry) => toStandardItem('cryptocompare_crypto', {
    externalId: toExternalId('cryptocompare_crypto', entry.categories, entry.id || entry.guid, entry.url, entry.title, entry.published_on),
    symbol: entry.categories || 'CRYPTO',
    title: entry.title,
    url: entry.url,
    summary: entry.body,
    publishedAt: entry.published_on ? new Date(Number(entry.published_on) * 1000).toISOString() : '',
  })).filter(Boolean);
}

function cnQuoteUrl(secid) {
  const [market, code] = String(secid).split('.');
  const prefix = market === '1' ? 'sh' : 'sz';
  return `https://quote.eastmoney.com/${prefix}${code}.html`;
}

function summarizeCnKlineRow(name, secid, row, prevRow) {
  const [date, open, close, high, low, volume, turnover] = row;
  const prevClose = prevRow ? Number(prevRow[2]) : NaN;
  const closeNum = Number(close);
  const pct = Number.isFinite(prevClose) && prevClose !== 0
    ? ((closeNum - prevClose) / prevClose) * 100
    : NaN;
  const pctText = Number.isFinite(pct) ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : '';

  return toStandardItem('eastmoney_cn', {
    externalId: toExternalId('eastmoney_cn', secid, date, cnQuoteUrl(secid), `${name} ${date}`, date),
    symbol: secid,
    title: `${name} ${date} 收盘 ${close}${pctText ? ` (${pctText})` : ''}`,
    url: cnQuoteUrl(secid),
    summary: `开:${open} 高:${high} 低:${low} 收:${close} 成交量:${volume} 成交额:${turnover}`,
    publishedAt: `${date}T07:00:00.000Z`,
  });
}

async function fetchEastmoneyCnItems(config) {
  const { cnSecids } = config;
  const all = [];

  const end = new Date();
  const beg = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const begStr = `${beg.getUTCFullYear()}${String(beg.getUTCMonth() + 1).padStart(2, '0')}${String(beg.getUTCDate()).padStart(2, '0')}`;
  const endStr = `${end.getUTCFullYear()}${String(end.getUTCMonth() + 1).padStart(2, '0')}${String(end.getUTCDate()).padStart(2, '0')}`;

  for (const secid of cnSecids) {
    const params = new URLSearchParams({
      secid,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
      klt: '101',
      fqt: '1',
      beg: begStr,
      end: endStr,
    });
    const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?${params.toString()}`;

    // eslint-disable-next-line no-await-in-loop
    const data = await fetchJson(url, { Referer: 'https://quote.eastmoney.com/' });
    const name = data?.data?.name || secid;
    const klines = Array.isArray(data?.data?.klines) ? data.data.klines : [];
    if (klines.length === 0) continue;

    const latest = String(klines[klines.length - 1]).split(',');
    const prev = klines.length > 1 ? String(klines[klines.length - 2]).split(',') : null;
    const item = summarizeCnKlineRow(name, secid, latest, prev);
    if (item) all.push(item);
  }

  return all;
}

async function fetchItemsByProvider(config) {
  switch (config.provider) {
    case 'yahoo_rss':
      return fetchYahooItems(config);
    case 'finnhub':
      return fetchFinnhubItems(config);
    case 'alpha_vantage':
      return fetchAlphaVantageItems(config);
    case 'polygon':
      return fetchPolygonItems(config);
    case 'eastmoney_cn':
      return fetchEastmoneyCnItems(config);
    case 'cryptocompare_crypto':
      return fetchCryptoCompareItems(config);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

/**
 * Fetch latest finance items from configured provider.
 * @returns {Promise<Array<{externalId: string, symbol: string, title: string, url: string, summary: string, publishedAt: string}>>}
 */
async function getLatestItems(config = {}) {
  const normalized = normalizeConfig(config);
  const list = await fetchItemsByProvider(normalized);

  const unique = new Map();
  for (const item of list) {
    const key = item.externalId || item.url || `${item.symbol}:${item.title}:${item.publishedAt}`;
    if (!key || unique.has(key)) continue;
    unique.set(key, item);
  }

  return [...unique.values()].sort((a, b) => {
    const ta = new Date(a.publishedAt || 0).getTime() || 0;
    const tb = new Date(b.publishedAt || 0).getTime() || 0;
    return tb - ta;
  });
}

module.exports = {
  SUPPORTED_PROVIDERS,
  normalizeConfig,
  getLatestItems,
};
