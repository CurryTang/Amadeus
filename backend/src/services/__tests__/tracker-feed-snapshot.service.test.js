const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTrackerFeedSnapshotId,
  paginateTrackerFeedSnapshot,
  shouldInvalidateTrackerFeedPageCache,
} = require('../tracker-feed-snapshot.service');

test('buildTrackerFeedSnapshotId returns a stable identifier for one snapshot', () => {
  const fetchedAt = Date.UTC(2026, 2, 8, 18, 0, 0);
  const snapshot = {
    fetchedAt,
    sourceCount: 5,
    data: [
      { arxivId: '2503.00001' },
      { arxivId: '2503.00002' },
      { arxivId: '2503.00003' },
    ],
  };

  assert.equal(
    buildTrackerFeedSnapshotId(snapshot),
    `${fetchedAt}:5:3:2503.00001`
  );
});

test('paginateTrackerFeedSnapshot slices a stable page without mutating source order', () => {
  const snapshot = {
    data: [
      { arxivId: '2503.00001' },
      { arxivId: '2503.00002' },
      { arxivId: '2503.00003' },
      { arxivId: '2503.00004' },
      { arxivId: '2503.00005' },
      { arxivId: '2503.00006' },
    ],
  };

  const page = paginateTrackerFeedSnapshot(snapshot, { offset: 2, limit: 3 });

  assert.deepEqual(page, {
    data: [
      { arxivId: '2503.00003' },
      { arxivId: '2503.00004' },
      { arxivId: '2503.00005' },
    ],
    hasMore: true,
    total: 6,
    offset: 2,
    limit: 3,
  });

  assert.deepEqual(snapshot.data, [
    { arxivId: '2503.00001' },
    { arxivId: '2503.00002' },
    { arxivId: '2503.00003' },
    { arxivId: '2503.00004' },
    { arxivId: '2503.00005' },
    { arxivId: '2503.00006' },
  ]);
});

test('shouldInvalidateTrackerFeedPageCache detects snapshot changes', () => {
  const fetchedAt = Date.UTC(2026, 2, 8, 18, 0, 0);
  const snapshotId = `${fetchedAt}:5:3:2503.00001`;
  assert.equal(
    shouldInvalidateTrackerFeedPageCache(
      { snapshotId },
      { fetchedAt, sourceCount: 5, data: [{ arxivId: '2503.00001' }, { arxivId: '2503.00002' }, { arxivId: '2503.00003' }] }
    ),
    false
  );

  assert.equal(
    shouldInvalidateTrackerFeedPageCache(
      { snapshotId },
      { fetchedAt: Date.UTC(2026, 2, 8, 19, 0, 0), sourceCount: 5, data: [{ arxivId: '2503.00001' }, { arxivId: '2503.00002' }, { arxivId: '2503.00003' }] }
    ),
    true
  );
});
