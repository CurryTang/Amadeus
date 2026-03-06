'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  createObserverStore,
} = require('../observer-store');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-session-observer-'));
}

test('observer store upserts records and lists by exact git root', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const store = await createObserverStore({ dbPath });

  try {
    await store.upsertSession({
      provider: 'codex',
      sessionId: 'sess_1',
      sessionFile: '/tmp/codex-1.jsonl',
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Implement evaluator',
      promptDigest: 'Implement evaluator',
      latestProgressDigest: 'Reading benchmark code',
      status: 'RUNNING',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:02:00.000Z',
      lastSize: 1200,
      lastMtime: 1710000000000,
      contentHash: 'abc123',
    });

    await store.upsertSession({
      provider: 'claude_code',
      sessionId: 'sess_2',
      sessionFile: '/tmp/claude-1.jsonl',
      cwd: '/repos/other',
      gitRoot: '/repos/other',
      title: 'Other project task',
      promptDigest: 'Other project task',
      latestProgressDigest: 'Done',
      status: 'SUCCEEDED',
      startedAt: '2026-03-06T09:00:00.000Z',
      updatedAt: '2026-03-06T09:30:00.000Z',
      lastSize: 800,
      lastMtime: 1709990000000,
      contentHash: 'def456',
    });

    const items = await store.listSessionsByGitRoot('/repos/openrfm');
    assert.equal(items.length, 1);
    assert.equal(items[0].sessionId, 'sess_1');
    assert.equal(items[0].provider, 'codex');
    assert.equal(items[0].gitRoot, '/repos/openrfm');
  } finally {
    await store.close();
  }
});

test('observer store updates an existing session record in place', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const store = await createObserverStore({ dbPath });

  try {
    await store.upsertSession({
      provider: 'codex',
      sessionId: 'sess_1',
      sessionFile: '/tmp/codex-1.jsonl',
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Implement evaluator',
      promptDigest: 'Implement evaluator',
      latestProgressDigest: 'Reading benchmark code',
      status: 'RUNNING',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:02:00.000Z',
      lastSize: 1200,
      lastMtime: 1710000000000,
      contentHash: 'abc123',
    });

    await store.upsertSession({
      provider: 'codex',
      sessionId: 'sess_1',
      sessionFile: '/tmp/codex-1.jsonl',
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Implement evaluator v2',
      promptDigest: 'Implement evaluator',
      latestProgressDigest: 'Patched metrics output',
      status: 'SUCCEEDED',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:08:00.000Z',
      lastSize: 1500,
      lastMtime: 1710000300000,
      contentHash: 'xyz789',
    });

    const item = await store.getSessionById('sess_1');
    assert.equal(item.title, 'Implement evaluator v2');
    assert.equal(item.status, 'SUCCEEDED');
    assert.equal(item.latestProgressDigest, 'Patched metrics output');
    assert.equal(item.contentHash, 'xyz789');
  } finally {
    await store.close();
  }
});

test('observer store returns null for unknown session ids', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const store = await createObserverStore({ dbPath });

  try {
    assert.equal(await store.getSessionById('missing'), null);
  } finally {
    await store.close();
  }
});
