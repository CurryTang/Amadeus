'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { requestDaemonRpc } = require('../daemon-rpc.service');

test('requestDaemonRpc resolves once the daemon reports success', async () => {
  const calls = [];
  let pollCount = 0;

  const result = await requestDaemonRpc({
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'project.checkPath',
    payload: { projectPath: '/Users/alice/my-project' },
    timeoutMs: 200,
    pollIntervalMs: 1,
    store: {
      enqueueDaemonTask: async (userId, payload) => {
        calls.push(['enqueue', userId, payload]);
        return { id: 'task_1' };
      },
      getDaemonTask: async () => {
        pollCount += 1;
        if (pollCount < 2) return { id: 'task_1', status: 'RUNNING' };
        return {
          id: 'task_1',
          status: 'SUCCEEDED',
          result: { normalizedPath: '/Users/alice/my-project', exists: true, isDirectory: true },
        };
      },
    },
  });

  assert.equal(calls[0][0], 'enqueue');
  assert.equal(result.exists, true);
  assert.equal(result.isDirectory, true);
});

test('requestDaemonRpc throws on timeout', async () => {
  await assert.rejects(() => requestDaemonRpc({
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'project.checkPath',
    payload: { projectPath: '/Users/alice/my-project' },
    timeoutMs: 10,
    pollIntervalMs: 1,
    store: {
      enqueueDaemonTask: async () => ({ id: 'task_1' }),
      getDaemonTask: async () => ({ id: 'task_1', status: 'RUNNING' }),
    },
  }), /timed out/i);
});
