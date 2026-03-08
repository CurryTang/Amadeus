const CACHE_KEY = 'latest_papers_cache_v7';
const CACHE_SOFT_TTL_MS = 10 * 60 * 1000;
const CACHE_HARD_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FALLBACK_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX_ITEMS = 300;

function getStorageValue(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch (_) {
    return null;
  }
}

function setStorageValue(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
  } catch (_) {}
}

function removeStorageValue(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch (_) {}
}

function normalizeSession(payload = {}) {
  const papers = Array.isArray(payload?.papers)
    ? payload.papers.slice(0, CACHE_MAX_ITEMS)
    : Array.isArray(payload?.data)
      ? payload.data.slice(0, CACHE_MAX_ITEMS)
      : null;
  const fetchedAt = Number(payload?.fetchedAt);
  if (!papers || papers.length === 0 || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return null;
  }

  return {
    papers,
    fetchedAt,
    hasMore: Boolean(payload?.hasMore),
    total: Number.isFinite(payload?.total) ? Number(payload.total) : papers.length,
    snapshotId: String(payload?.snapshotId || '').trim(),
  };
}

function readLatestPapersSession(storage = globalThis?.localStorage, { now = Date.now(), allowStale = false } = {}) {
  try {
    const raw = getStorageValue(storage, CACHE_KEY);
    if (!raw) return null;
    const normalized = normalizeSession(JSON.parse(raw));
    if (!normalized) return null;
    const ageMs = Math.max(0, Number(now) - normalized.fetchedAt);
    if (!Number.isFinite(ageMs) || ageMs > CACHE_FALLBACK_MAX_AGE_MS) {
      removeStorageValue(storage, CACHE_KEY);
      return null;
    }
    if (!allowStale && ageMs > CACHE_HARD_TTL_MS) {
      removeStorageValue(storage, CACHE_KEY);
      return null;
    }

    return {
      ...normalized,
      ageMs,
      isSoftExpired: ageMs >= CACHE_SOFT_TTL_MS,
      isHardExpired: ageMs >= CACHE_HARD_TTL_MS,
    };
  } catch (_) {
    removeStorageValue(storage, CACHE_KEY);
    return null;
  }
}

function writeLatestPapersSession(
  storage = globalThis?.localStorage,
  { papers = [], fetchedAt, hasMore = false, total, snapshotId = '' } = {}
) {
  const normalized = normalizeSession({ papers, fetchedAt, hasMore, total, snapshotId });
  if (!normalized) return null;
  setStorageValue(storage, CACHE_KEY, JSON.stringify(normalized));
  return normalized;
}

function clearLatestPapersSession(storage = globalThis?.localStorage) {
  removeStorageValue(storage, CACHE_KEY);
}

export {
  CACHE_HARD_TTL_MS,
  CACHE_KEY,
  CACHE_MAX_ITEMS,
  CACHE_SOFT_TTL_MS,
  clearLatestPapersSession,
  readLatestPapersSession,
  writeLatestPapersSession,
};
