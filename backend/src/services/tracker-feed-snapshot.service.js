function getTrackerFeedItemKey(item = {}) {
  return String(
    item?.arxivId
    || item?.externalId
    || item?.url
    || item?.title
    || ''
  ).trim();
}

function buildTrackerFeedSnapshotId(snapshot = {}) {
  const fetchedAt = Number(snapshot?.fetchedAt || 0) || 0;
  const sourceCount = Number(snapshot?.sourceCount || 0) || 0;
  const data = Array.isArray(snapshot?.data) ? snapshot.data : [];
  const firstKey = getTrackerFeedItemKey(data[0]);
  return `${fetchedAt}:${sourceCount}:${data.length}:${firstKey}`;
}

function paginateTrackerFeedSnapshot(snapshot = {}, { offset = 0, limit = 5 } = {}) {
  const data = Array.isArray(snapshot?.data) ? snapshot.data : [];
  const safeOffset = Number.isFinite(offset) ? Math.max(0, offset) : 0;
  const safeLimit = Number.isFinite(limit) ? Math.max(1, limit) : 5;
  const page = data.slice(safeOffset, safeOffset + safeLimit);
  return {
    data: page,
    hasMore: safeOffset + page.length < data.length,
    total: data.length,
    offset: safeOffset,
    limit: safeLimit,
  };
}

function shouldInvalidateTrackerFeedPageCache(cacheState = {}, snapshot = {}) {
  return String(cacheState?.snapshotId || '') !== buildTrackerFeedSnapshotId(snapshot);
}

function createTrackerFeedPageCache() {
  return {
    snapshotId: '',
    pages: new Map(),
  };
}

async function resolveTrackerFeedAnnotatedPage({
  cacheState,
  snapshot = {},
  offset = 0,
  limit = 5,
  viewerKey = 'public',
  annotatePage,
} = {}) {
  const pageCache = cacheState || createTrackerFeedPageCache();
  const snapshotId = buildTrackerFeedSnapshotId(snapshot);
  if (pageCache.snapshotId !== snapshotId) {
    pageCache.snapshotId = snapshotId;
    pageCache.pages = new Map();
  }

  const page = paginateTrackerFeedSnapshot(snapshot, { offset, limit });
  const pageCacheKey = `${viewerKey}:${page.offset}:${page.limit}`;
  if (pageCache.pages.has(pageCacheKey)) {
    return {
      ...pageCache.pages.get(pageCacheKey),
      snapshotId,
      cachedPage: true,
    };
  }

  const annotatedData = typeof annotatePage === 'function'
    ? await annotatePage(page.data)
    : page.data;
  const resolvedPage = {
    ...page,
    data: Array.isArray(annotatedData) ? annotatedData : page.data,
    snapshotId,
    cachedPage: false,
  };
  pageCache.pages.set(pageCacheKey, resolvedPage);
  return resolvedPage;
}

module.exports = {
  buildTrackerFeedSnapshotId,
  createTrackerFeedPageCache,
  getTrackerFeedItemKey,
  paginateTrackerFeedSnapshot,
  resolveTrackerFeedAnnotatedPage,
  shouldInvalidateTrackerFeedPageCache,
};
