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

function getFeedItemKey(item) {
  if (!item || typeof item !== 'object') return '';
  return String(
    item.arxivId
    || item.externalId
    || item.url
    || item.title
    || ''
  ).trim();
}

function mergeSessionPapers(currentPapers = [], incomingPapers = []) {
  const merged = [...(Array.isArray(currentPapers) ? currentPapers : [])];
  const existing = new Set(merged.map((paper) => getFeedItemKey(paper)).filter(Boolean));
  for (const paper of Array.isArray(incomingPapers) ? incomingPapers : []) {
    const key = getFeedItemKey(paper);
    if (!key || existing.has(key)) continue;
    existing.add(key);
    merged.push(paper);
  }
  return merged.slice(0, CACHE_MAX_ITEMS);
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

function resolveLatestPapersSessionUpdate({
  currentSession = null,
  incomingSession = null,
  append = false,
  background = false,
  manualRefresh = false,
} = {}) {
  const normalizedCurrent = normalizeSession(currentSession || {});
  const normalizedIncoming = normalizeSession(incomingSession || {});
  if (!normalizedIncoming) {
    return {
      session: normalizedCurrent,
      replaced: false,
      newFeedAvailable: false,
    };
  }

  if (!normalizedCurrent || manualRefresh) {
    return {
      session: normalizedIncoming,
      replaced: true,
      newFeedAvailable: false,
    };
  }

  if (append) {
    return {
      session: {
        ...normalizedIncoming,
        papers: mergeSessionPapers(normalizedCurrent.papers, normalizedIncoming.papers),
      },
      replaced: false,
      newFeedAvailable: false,
    };
  }

  if (background && normalizedCurrent.papers.length > normalizedIncoming.papers.length) {
    const newFeedAvailable = (
      (normalizedIncoming.snapshotId && normalizedIncoming.snapshotId !== normalizedCurrent.snapshotId)
      || normalizedIncoming.fetchedAt > normalizedCurrent.fetchedAt
    );
    return {
      session: normalizedCurrent,
      replaced: false,
      newFeedAvailable,
    };
  }

  return {
    session: normalizedIncoming,
    replaced: true,
    newFeedAvailable: false,
  };
}

export {
  CACHE_HARD_TTL_MS,
  CACHE_KEY,
  CACHE_MAX_ITEMS,
  CACHE_SOFT_TTL_MS,
  clearLatestPapersSession,
  readLatestPapersSession,
  resolveLatestPapersSessionUpdate,
  writeLatestPapersSession,
};
