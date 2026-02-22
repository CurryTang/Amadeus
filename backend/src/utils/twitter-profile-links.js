const TWITTER_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

function extractHandleFromUrl(input) {
  try {
    const url = new URL(input);
    if (!TWITTER_HOSTS.has(url.hostname.toLowerCase())) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;

    const candidate = parts[0].replace(/^@/, '');
    if (!HANDLE_PATTERN.test(candidate)) return null;
    return candidate;
  } catch (_) {
    return null;
  }
}

function extractTwitterHandle(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  const fromUrl = extractHandleFromUrl(raw);
  if (fromUrl) return fromUrl;

  const candidate = raw.replace(/^@/, '').split('/')[0].trim();
  if (!HANDLE_PATTERN.test(candidate)) return null;
  return candidate;
}

function normalizeTwitterProfileLink(input) {
  const handle = extractTwitterHandle(input);
  if (!handle) return null;
  return `https://x.com/${handle}`;
}

function splitProfileLinks(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .flatMap((item) => String(item || '').split(/[\n,]/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return String(input)
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeTwitterProfileLinks(input) {
  const raw = splitProfileLinks(input);
  const normalized = [];
  const invalid = [];
  const seen = new Set();

  for (const item of raw) {
    const url = normalizeTwitterProfileLink(item);
    if (!url) {
      invalid.push(item);
      continue;
    }
    if (seen.has(url)) continue;
    seen.add(url);
    normalized.push(url);
  }

  return { normalized, invalid };
}

module.exports = {
  extractTwitterHandle,
  normalizeTwitterProfileLink,
  normalizeTwitterProfileLinks,
};
