import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readLatestPapersSession,
  resolveLatestPapersSessionUpdate,
  shouldTreatTrackerFetchAsManualRefresh,
  writeLatestPapersSession,
} from './latestPapersSession.js';

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('readLatestPapersSession restores an expanded cached feed session', () => {
  const storage = createStorage();
  const fetchedAt = Date.UTC(2026, 2, 8, 12, 0, 0);

  writeLatestPapersSession(storage, {
    papers: [
      { arxivId: '2503.00001', title: 'Paper One' },
      { arxivId: '2503.00002', title: 'Paper Two' },
      { arxivId: '2503.00003', title: 'Paper Three' },
    ],
    fetchedAt,
    hasMore: true,
    total: 197,
    snapshotId: 'snapshot-2026-03-08T12:00:00.000Z',
  });

  const session = readLatestPapersSession(storage, { now: fetchedAt + 60_000 });

  assert.deepEqual(session, {
    papers: [
      { arxivId: '2503.00001', title: 'Paper One' },
      { arxivId: '2503.00002', title: 'Paper Two' },
      { arxivId: '2503.00003', title: 'Paper Three' },
    ],
    fetchedAt,
    hasMore: true,
    total: 197,
    snapshotId: 'snapshot-2026-03-08T12:00:00.000Z',
    ageMs: 60_000,
    isSoftExpired: false,
    isHardExpired: false,
  });
});

test('readLatestPapersSession rejects malformed and expired cache payloads', () => {
  const storage = createStorage();
  const now = Date.UTC(2026, 2, 8, 12, 0, 0);

  storage.setItem('latest_papers_cache_v7', '{"papers":"bad-shape"}');
  assert.equal(readLatestPapersSession(storage, { now }), null);

  writeLatestPapersSession(storage, {
    papers: [{ arxivId: '2503.00009', title: 'Expired Paper' }],
    fetchedAt: now - (8 * 24 * 60 * 60 * 1000),
    hasMore: false,
    total: 1,
    snapshotId: 'snapshot-expired',
  });

  assert.equal(readLatestPapersSession(storage, { now }), null);
});

test('resolveLatestPapersSessionUpdate keeps expanded state during background refresh', () => {
  const currentSession = {
    papers: [
      { arxivId: '2503.00001', title: 'Paper One' },
      { arxivId: '2503.00002', title: 'Paper Two' },
      { arxivId: '2503.00003', title: 'Paper Three' },
      { arxivId: '2503.00004', title: 'Paper Four' },
      { arxivId: '2503.00005', title: 'Paper Five' },
      { arxivId: '2503.00006', title: 'Paper Six' },
    ],
    fetchedAt: Date.UTC(2026, 2, 8, 12, 0, 0),
    hasMore: true,
    total: 197,
    snapshotId: 'snapshot-old',
  };

  const incomingSession = {
    papers: [
      { arxivId: '2503.10001', title: 'New Page One' },
      { arxivId: '2503.10002', title: 'New Page Two' },
      { arxivId: '2503.10003', title: 'New Page Three' },
      { arxivId: '2503.10004', title: 'New Page Four' },
      { arxivId: '2503.10005', title: 'New Page Five' },
    ],
    fetchedAt: Date.UTC(2026, 2, 8, 12, 15, 0),
    hasMore: true,
    total: 205,
    snapshotId: 'snapshot-new',
  };

  const result = resolveLatestPapersSessionUpdate({
    currentSession,
    incomingSession,
    append: false,
    background: true,
  });

  assert.deepEqual(result, {
    session: currentSession,
    replaced: false,
    newFeedAvailable: true,
  });
});

test('resolveLatestPapersSessionUpdate keeps state during background refresh even with equal paper count', () => {
  const currentSession = {
    papers: [
      { arxivId: '2503.00001', title: 'Paper One' },
      { arxivId: '2503.00002', title: 'Paper Two' },
      { arxivId: '2503.00003', title: 'Paper Three' },
    ],
    fetchedAt: Date.UTC(2026, 2, 8, 12, 0, 0),
    hasMore: true,
    total: 197,
    snapshotId: 'snapshot-old',
  };

  // Background refresh returns same number of papers but different snapshot
  const result = resolveLatestPapersSessionUpdate({
    currentSession,
    incomingSession: {
      papers: [
        { arxivId: '2503.10001', title: 'New One' },
        { arxivId: '2503.10002', title: 'New Two' },
        { arxivId: '2503.10003', title: 'New Three' },
      ],
      fetchedAt: Date.UTC(2026, 2, 8, 12, 15, 0),
      hasMore: true,
      total: 205,
      snapshotId: 'snapshot-new',
    },
    append: false,
    background: true,
  });

  assert.equal(result.replaced, false);
  assert.equal(result.newFeedAvailable, true);
  assert.deepEqual(result.session.papers, currentSession.papers);
});

test('resolveLatestPapersSessionUpdate appends unique papers and resets on manual refresh', () => {
  const currentSession = {
    papers: [
      { arxivId: '2503.00001', title: 'Paper One' },
      { arxivId: '2503.00002', title: 'Paper Two' },
    ],
    fetchedAt: Date.UTC(2026, 2, 8, 12, 0, 0),
    hasMore: true,
    total: 197,
    snapshotId: 'snapshot-old',
  };

  const appended = resolveLatestPapersSessionUpdate({
    currentSession,
    incomingSession: {
      papers: [
        { arxivId: '2503.00002', title: 'Paper Two' },
        { arxivId: '2503.00003', title: 'Paper Three' },
      ],
      fetchedAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      hasMore: true,
      total: 197,
      snapshotId: 'snapshot-old',
    },
    append: true,
    background: false,
  });

  assert.deepEqual(appended, {
    session: {
      papers: [
        { arxivId: '2503.00001', title: 'Paper One' },
        { arxivId: '2503.00002', title: 'Paper Two' },
        { arxivId: '2503.00003', title: 'Paper Three' },
      ],
      fetchedAt: Date.UTC(2026, 2, 8, 12, 0, 0),
      hasMore: true,
      total: 197,
      snapshotId: 'snapshot-old',
    },
    replaced: false,
    newFeedAvailable: false,
  });

  const refreshed = resolveLatestPapersSessionUpdate({
    currentSession,
    incomingSession: {
      papers: [{ arxivId: '2503.10001', title: 'Fresh Page One' }],
      fetchedAt: Date.UTC(2026, 2, 8, 12, 20, 0),
      hasMore: true,
      total: 205,
      snapshotId: 'snapshot-new',
    },
    append: false,
    background: false,
    manualRefresh: true,
  });

  assert.deepEqual(refreshed, {
    session: {
      papers: [{ arxivId: '2503.10001', title: 'Fresh Page One' }],
      fetchedAt: Date.UTC(2026, 2, 8, 12, 20, 0),
      hasMore: true,
      total: 205,
      snapshotId: 'snapshot-new',
    },
    replaced: true,
    newFeedAvailable: false,
  });
});

test('shouldTreatTrackerFetchAsManualRefresh keeps background refresh out of the reset path', () => {
  assert.equal(
    shouldTreatTrackerFetchAsManualRefresh({
      background: true,
      forceRefresh: true,
      forceCrawl: false,
      shuffle: false,
    }),
    false
  );

  assert.equal(
    shouldTreatTrackerFetchAsManualRefresh({
      background: false,
      forceRefresh: true,
      forceCrawl: true,
      shuffle: true,
    }),
    true
  );
});
