const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTrackerFeedSnapshotId,
  createTrackerFeedPageCache,
  resolveTrackerFeedAnnotatedPage,
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

test('resolveTrackerFeedAnnotatedPage reuses cached annotation results for the same snapshot page', async () => {
  const cacheState = createTrackerFeedPageCache();
  const snapshot = {
    fetchedAt: Date.UTC(2026, 2, 8, 18, 0, 0),
    sourceCount: 5,
    data: [
      { arxivId: '2503.00001' },
      { arxivId: '2503.00002' },
      { arxivId: '2503.00003' },
      { arxivId: '2503.00004' },
      { arxivId: '2503.00005' },
    ],
  };
  let annotateCalls = 0;

  const first = await resolveTrackerFeedAnnotatedPage({
    cacheState,
    snapshot,
    offset: 0,
    limit: 2,
    viewerKey: 'user:demo',
    annotatePage: async (page) => {
      annotateCalls += 1;
      return page.map((item) => ({ ...item, saved: true }));
    },
  });

  const second = await resolveTrackerFeedAnnotatedPage({
    cacheState,
    snapshot,
    offset: 0,
    limit: 2,
    viewerKey: 'user:demo',
    annotatePage: async () => {
      annotateCalls += 1;
      throw new Error('should not annotate twice');
    },
  });

  assert.equal(annotateCalls, 1);
  assert.equal(first.snapshotId, second.snapshotId);
  assert.deepEqual(second.data, first.data);
});

test('resolveTrackerFeedAnnotatedPage annotates only the requested page when full annotation is unavailable', async () => {
  const cacheState = createTrackerFeedPageCache();
  const snapshot = {
    fetchedAt: Date.UTC(2026, 2, 8, 18, 0, 0),
    sourceCount: 5,
    data: [
      { arxivId: '2503.00001' },
      { arxivId: '2503.00002' },
      { arxivId: '2503.00003' },
      { arxivId: '2503.00004' },
      { arxivId: '2503.00005' },
    ],
  };
  const seenPages = [];

  const result = await resolveTrackerFeedAnnotatedPage({
    cacheState,
    snapshot,
    offset: 2,
    limit: 2,
    viewerKey: 'user:demo',
    annotatePage: async (page) => {
      seenPages.push(page.map((item) => item.arxivId));
      return page.map((item) => ({ ...item, saved: true }));
    },
  });

  assert.deepEqual(seenPages, [['2503.00003', '2503.00004']]);
  assert.equal(result.snapshotId, `${snapshot.fetchedAt}:5:5:2503.00001`);
  assert.equal(result.hasMore, true);
  assert.deepEqual(result.data, [
    { arxivId: '2503.00003', saved: true },
    { arxivId: '2503.00004', saved: true },
  ]);
});
