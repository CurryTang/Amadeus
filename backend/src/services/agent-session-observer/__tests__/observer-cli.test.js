'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createObserverStore } = require('../observer-store');
const { runObserverCli } = require('../observer-cli');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-session-observer-cli-'));
}

test('observer cli list returns sessions by exact git root', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const sessionFile = path.join(dir, 'session.jsonl');
  await fs.writeFile(sessionFile, 'line-1\nline-2\n', 'utf8');
  const store = await createObserverStore({ dbPath });

  try {
    await store.upsertSession({
      provider: 'codex',
      sessionId: 'sess_1',
      sessionFile,
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Implement evaluator',
      promptDigest: 'Implement evaluator',
      latestProgressDigest: 'Reading benchmark code',
      status: 'RUNNING',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:02:00.000Z',
      lastSize: 12,
      lastMtime: 1710000000000,
      contentHash: 'abc123',
    });

    const result = await runObserverCli(['list', '--db-path', dbPath, '--git-root', '/repos/openrfm', '--json']);
    assert.equal(Array.isArray(result.items), true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].sessionId, 'sess_1');
  } finally {
    await store.close();
  }
});

test('observer cli get returns one session by id', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const sessionFile = path.join(dir, 'session.jsonl');
  await fs.writeFile(sessionFile, 'line-1\nline-2\n', 'utf8');
  const store = await createObserverStore({ dbPath });

  try {
    await store.upsertSession({
      provider: 'codex',
      sessionId: 'sess_1',
      sessionFile,
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Implement evaluator',
      promptDigest: 'Implement evaluator',
      latestProgressDigest: 'Reading benchmark code',
      status: 'RUNNING',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:02:00.000Z',
      lastSize: 12,
      lastMtime: 1710000000000,
      contentHash: 'abc123',
    });

    const result = await runObserverCli(['get', '--db-path', dbPath, '--session-id', 'sess_1', '--json']);
    assert.equal(result.item.sessionId, 'sess_1');
    assert.equal(result.item.title, 'Implement evaluator');
  } finally {
    await store.close();
  }
});

test('observer cli excerpt returns a bounded tail excerpt', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const sessionFile = path.join(dir, 'session.jsonl');
  await fs.writeFile(sessionFile, 'a\nb\nc\nd\n', 'utf8');
  const store = await createObserverStore({ dbPath });

  try {
    await store.upsertSession({
      provider: 'claude_code',
      sessionId: 'sess_2',
      sessionFile,
      cwd: '/repos/openrfm',
      gitRoot: '/repos/openrfm',
      title: 'Debug observer',
      promptDigest: 'Debug observer',
      latestProgressDigest: 'Checking worker output',
      status: 'SUCCEEDED',
      startedAt: '2026-03-06T10:00:00.000Z',
      updatedAt: '2026-03-06T10:02:00.000Z',
      lastSize: 8,
      lastMtime: 1710000000000,
      contentHash: 'abc123',
    });

    const result = await runObserverCli(['excerpt', '--db-path', dbPath, '--session-id', 'sess_2', '--limit', '2', '--json']);
    assert.equal(result.sessionId, 'sess_2');
    assert.equal(result.excerpt, 'c\nd');
  } finally {
    await store.close();
  }
});
