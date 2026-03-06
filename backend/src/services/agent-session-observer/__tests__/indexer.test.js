'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const { createObserverStore } = require('../observer-store');
const { runObserverIndexTick } = require('../indexer');

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-session-indexer-'));
}

test('runObserverIndexTick only reparses changed files and memoizes git roots', async () => {
  const dir = await makeTempDir();
  const dbPath = path.join(dir, 'observer.db');
  const store = await createObserverStore({ dbPath });
  const codexFile = path.join(dir, 'rollout-2026-03-06T10-00-00-abc.jsonl');
  const claudeFile = path.join(dir, 'claude-session.jsonl');

  await fs.writeFile(codexFile, [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repos/openrfm', model_provider: 'openai' }, timestamp: '2026-03-06T10:00:00.000Z' }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Implement evaluator for openrfm' } }),
  ].join('\n'), 'utf8');

  await fs.writeFile(claudeFile, [
    JSON.stringify({
      type: 'user',
      cwd: '/repos/openrfm',
      gitBranch: 'main',
      slug: 'openrfm-debug',
      timestamp: '2026-03-06T10:05:00.000Z',
      message: { content: 'Debug openrfm session observer' },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-03-06T10:06:00.000Z',
      message: { content: [{ type: 'tool_use', name: 'read_file' }] },
    }),
  ].join('\n'), 'utf8');

  let parseCalls = 0;
  let gitRootCalls = 0;
  const resolveGitRootFn = (cwd) => {
    gitRootCalls += 1;
    return cwd;
  };

  const parseSessionFileFn = async (filepath, context) => {
    parseCalls += 1;
    return require('../indexer').parseSessionFile(filepath, context);
  };

  let state = await runObserverIndexTick({
    store,
    state: null,
    listSessionFilesFn: async () => [codexFile, claudeFile],
    parseSessionFileFn,
    resolveGitRootFn,
  });

  assert.equal(parseCalls, 2);
  assert.equal(gitRootCalls, 1);
  assert.equal((await store.listSessionsByGitRoot('/repos/openrfm')).length, 2);

  state = await runObserverIndexTick({
    store,
    state,
    listSessionFilesFn: async () => [codexFile, claudeFile],
    parseSessionFileFn,
    resolveGitRootFn,
  });

  assert.equal(parseCalls, 2);
  assert.equal(gitRootCalls, 1);

  await fs.writeFile(codexFile, [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/repos/openrfm', model_provider: 'openai' }, timestamp: '2026-03-06T10:00:00.000Z' }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'Implement evaluator for openrfm' } }),
    JSON.stringify({ type: 'turn_context', payload: { cwd: '/repos/openrfm', summary: 'Patched scoring output', turn_id: 'turn_2' }, timestamp: '2026-03-06T10:10:00.000Z' }),
  ].join('\n'), 'utf8');

  state = await runObserverIndexTick({
    store,
    state,
    listSessionFilesFn: async () => [codexFile, claudeFile],
    parseSessionFileFn,
    resolveGitRootFn,
  });

  assert.equal(parseCalls, 3);
  assert.equal(gitRootCalls, 1);

  const items = await store.listSessionsByGitRoot('/repos/openrfm');
  assert.equal(items.length, 2);
  assert.equal(items[0].latestProgressDigest, 'Patched scoring output');

  await store.close();
});
