import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readLatestPapersSession,
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
