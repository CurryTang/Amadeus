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

module.exports = {
  buildTrackerFeedSnapshotId,
  getTrackerFeedItemKey,
  paginateTrackerFeedSnapshot,
  shouldInvalidateTrackerFeedPageCache,
};
