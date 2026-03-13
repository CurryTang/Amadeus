'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');

const {
  ensureRemoteObserverInstalled,
  getObservedSessionExcerptViaSshObserver,
  getObservedSessionViaSshObserver,
  listObservedSessionsViaSshObserver,
  runObserverCommandWithAutoInstall,
} = require('../ssh-observed-session-proxy.service');

const server = {
  user: 'alice',
  host: 'example.com',
  port: 22,
};

test('listObservedSessionsViaSshObserver issues a list command and returns parsed items', async () => {
  const calls = [];
  const result = await listObservedSessionsViaSshObserver({
    server,
    gitRoot: '/repos/openrfm',
    runRemoteFn: async (input) => {
      calls.push(input);
      return {
        items: [{ sessionId: 'sess_1', gitRoot: '/repos/openrfm', title: 'Implement evaluator' }],
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[0], 'list');
  assert.deepEqual(calls[0].args.slice(1), ['--git-root', '/repos/openrfm', '--sync', '--json']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sessionId, 'sess_1');
});

test('getObservedSessionViaSshObserver issues a get command and returns one item', async () => {
  const calls = [];
  const result = await getObservedSessionViaSshObserver({
    server,
    sessionId: 'sess_2',
    runRemoteFn: async (input) => {
      calls.push(input);
      return {
        item: { sessionId: 'sess_2', title: 'Debug observer' },
      };
    },
  });

  assert.equal(calls[0].args[0], 'get');
  assert.deepEqual(calls[0].args.slice(1), ['--session-id', 'sess_2', '--sync', '--json']);
  assert.equal(result.item.title, 'Debug observer');
});

test('getObservedSessionExcerptViaSshObserver issues an excerpt command with a limit', async () => {
  const calls = [];
  const result = await getObservedSessionExcerptViaSshObserver({
    server,
    sessionId: 'sess_3',
    limit: 80,
    runRemoteFn: async (input) => {
      calls.push(input);
      return {
        sessionId: 'sess_3',
        excerpt: 'tail output',
      };
    },
  });

  assert.equal(calls[0].args[0], 'excerpt');
  assert.deepEqual(calls[0].args.slice(1), ['--session-id', 'sess_3', '--limit', '80', '--sync', '--json']);
  assert.equal(result.excerpt, 'tail output');
});

test('runObserverCommandWithAutoInstall installs and retries when observer is missing', async () => {
  const calls = [];
  let installCalls = 0;
  const result = await runObserverCommandWithAutoInstall({
    server,
    args: ['list', '--git-root', '/repos/openrfm', '--sync', '--json'],
    runRemoteFn: async (input) => {
      calls.push(input);
      if (calls.length === 1) {
        const error = new Error('bash: /home/alice/.researchops/agent-session-observer/bin/researchops-agent-observer: No such file or directory');
        throw error;
      }
      return { items: [{ sessionId: 'sess_1' }] };
    },
    ensureInstalledFn: async () => {
      installCalls += 1;
    },
  });

  assert.equal(installCalls, 1);
  assert.equal(calls.length, 2);
  assert.equal(result.items[0].sessionId, 'sess_1');
});

test('ensureRemoteObserverInstalled creates install directories, copies files, and runs npm install', async () => {
  const copied = [];
  const scripted = [];
  const copiedContents = new Map();
  await ensureRemoteObserverInstalled({
    server,
    copyToFn: async (targetServer, localPath, remotePath) => {
      copied.push({ targetServer, localPath, remotePath });
      copiedContents.set(remotePath, await fs.readFile(localPath, 'utf8'));
    },
    scriptFn: async (targetServer, scriptBody) => {
      scripted.push({ targetServer, scriptBody });
      return { stdout: '', stderr: '', code: 0 };
    },
  });

  assert.equal(copied.length >= 4, true);
  assert.equal(scripted.length >= 2, true);
  assert.match(scripted[0].scriptBody, /mkdir -p .*agent-session-observer/);
  assert.match(scripted[scripted.length - 1].scriptBody, /npm install --omit=dev --no-audit --no-fund/);
  for (const item of copied) {
    assert.equal(item.remotePath.startsWith('~'), false);
  }
  const wrapper = copiedContents.get('.researchops/agent-session-observer/bin/researchops-agent-observer');
  assert.match(wrapper, /os\.homedir\(\)/);
  assert.doesNotMatch(wrapper, /~\/\.researchops/);
});
