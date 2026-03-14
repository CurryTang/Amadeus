function normalizeTitle(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isLikelySocialPostTitle(title) {
  const normalized = normalizeTitle(title);
  if (!normalized) return false;
  if (/https?:\/\//i.test(normalized)) return true;
  if (/(^|\s)#\w+/.test(normalized)) return true;
  if (/(^|\s)@\w+/.test(normalized)) return true;
  if (/^\d{1,2}\s*\/\s*\d{1,2}\b/.test(normalized)) return true;

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

function defaultChooseBestTitle(primary, fallback, arxivId = '') {
  const a = normalizeTitle(primary);
  const b = normalizeTitle(fallback);
  if (a && !isLowSignalTitle(a)) return a;
  if (b && !isLowSignalTitle(b)) return b;
  if (a) return a;
  if (b) return b;
  return `arXiv:${arxivId}`;
}

function normalizeTrackerSourceType(type) {
  return String(type || '').trim().toLowerCase();
}

function isTwitterArxivItem(item = {}) {
  if (!item?.arxivId) return false;
  const primaryType = normalizeTrackerSourceType(item.sourceType);
  if (primaryType === 'twitter') return true;
  const sourceTypes = Array.isArray(item.sourceTypes) ? item.sourceTypes : [];
  return sourceTypes.some((type) => normalizeTrackerSourceType(type) === 'twitter');
}

function needsTrackerFeedArxivEnrichment(item) {
  return isTwitterArxivItem(item) && isLowSignalTitle(item.title);
}

function createTrackerArxivFeedMetadataState() {
  return {
    cache: new Map(),
    inflight: new Map(),
    lastRequestStartedAt: 0,
  };
}

function pruneTrackerArxivFeedCache(state, nowMs, cacheTtlMs, maxEntries = 512) {
  if (!state?.cache || !(state.cache instanceof Map)) return;

  for (const [key, entry] of state.cache.entries()) {
    if (!entry || !Number.isFinite(entry.fetchedAt) || nowMs - entry.fetchedAt >= cacheTtlMs) {
      state.cache.delete(key);
    }
  }

  if (state.cache.size <= maxEntries) return;

  const overflow = state.cache.size - maxEntries;
  const entries = [...state.cache.entries()]
    .sort((a, b) => (a[1]?.fetchedAt || 0) - (b[1]?.fetchedAt || 0))
    .slice(0, overflow);
  for (const [key] of entries) {
    state.cache.delete(key);
  }
}

async function fetchTrackerFeedMetadata(arxivId, options = {}) {
  const {
    fetchMetadata,
    state = createTrackerArxivFeedMetadataState(),
    cacheTtlMs = 12 * 60 * 60 * 1000,
    minIntervalMs = 3000,
    now = () => Date.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  if (!arxivId || typeof fetchMetadata !== 'function') return null;

  const cached = state.cache.get(arxivId);
  const nowMs = now();
  if (cached && Number.isFinite(cached.fetchedAt) && nowMs - cached.fetchedAt < cacheTtlMs) {
    return cached.value;
  }

  if (state.inflight.has(arxivId)) {
    return state.inflight.get(arxivId);
  }

  const requestPromise = (async () => {
    const elapsed = state.lastRequestStartedAt > 0 ? now() - state.lastRequestStartedAt : Number.POSITIVE_INFINITY;
    const waitMs = Number.isFinite(elapsed) ? Math.max(0, minIntervalMs - elapsed) : 0;
    if (waitMs > 0) {
      await wait(waitMs);
    }

    state.lastRequestStartedAt = now();
    const metadata = await fetchMetadata(arxivId);
    state.cache.set(arxivId, {
      value: metadata,
      fetchedAt: now(),
    });
    pruneTrackerArxivFeedCache(state, now(), cacheTtlMs);
    return metadata;
  })();

  state.inflight.set(arxivId, requestPromise);
  try {
    return await requestPromise;
  } finally {
    state.inflight.delete(arxivId);
  }
}

async function enrichTrackerFeedWithArxivMetadata(items = [], options = {}) {
  const {
    maxEnrich = 3,
    state = createTrackerArxivFeedMetadataState(),
    chooseBestTitle = defaultChooseBestTitle,
    parsePublishedAt = (value) => String(value || '').trim(),
  } = options;

  if (!Array.isArray(items) || items.length === 0 || maxEnrich <= 0) {
    return Array.isArray(items) ? items : [];
  }

  const enriched = [...items];
  const candidates = items
    .map((item, idx) => ({ item, idx }))
    .filter(({ item }) => needsTrackerFeedArxivEnrichment(item))
    .slice(0, maxEnrich);

  for (const { item, idx } of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const meta = await fetchTrackerFeedMetadata(item.arxivId, {
        ...options,
        state,
      });
      if (!meta) continue;

      const next = { ...enriched[idx] };
      next.title = chooseBestTitle(next.title, meta?.title, item.arxivId);
      if (String(next.abstract || '').trim().length < 60 && meta?.abstract) {
        next.abstract = String(meta.abstract).trim();
      }
      if ((!Array.isArray(next.authors) || next.authors.length === 0) && Array.isArray(meta?.authors)) {
        next.authors = meta.authors;
      }
      if (!next.publishedAt && meta?.published) {
        next.publishedAt = parsePublishedAt(meta.published);
      }
      enriched[idx] = next;
    } catch (_) {
      // Keep the original feed item when metadata enrichment fails or times out.
    }
  }

  return enriched;
}

module.exports = {
  createTrackerArxivFeedMetadataState,
  enrichTrackerFeedWithArxivMetadata,
  fetchTrackerFeedMetadata,
  needsTrackerFeedArxivEnrichment,
};
