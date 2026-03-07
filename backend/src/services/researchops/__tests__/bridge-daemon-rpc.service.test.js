'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchNodeBridgeContextViaDaemon,
  fetchRunContextPackViaDaemon,
  fetchRunBridgeReportViaDaemon,
  submitNodeBridgeRunViaDaemon,
  submitRunBridgeNoteViaDaemon,
} = require('../bridge-daemon-rpc.service');

test('fetchNodeBridgeContextViaDaemon delegates to requestDaemonRpc with the bridge node-context task', async () => {
  const calls = [];
  const result = await fetchNodeBridgeContextViaDaemon({
    userId: 'czk',
    serverId: 'srv_client_1',
    projectId: 'proj_1',
    nodeId: 'node_eval',
    includeContextPack: true,
    includeReport: true,
    requestDaemonRpc: async (input) => {
      calls.push(input);
      return { bridgeVersion: 'v0' };
    },
  });

  assert.equal(result.bridgeVersion, 'v0');
  assert.deepEqual(calls, [{
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchNodeContext',
    payload: {
      projectId: 'proj_1',
      nodeId: 'node_eval',
      includeContextPack: true,
      includeReport: true,
    },
  }]);
});

test('submitNodeBridgeRunViaDaemon delegates to requestDaemonRpc with snapshot-backed bridge run payload', async () => {
  const calls = [];
  await submitNodeBridgeRunViaDaemon({
    userId: 'czk',
    serverId: 'srv_client_1',
    projectId: 'proj_1',
    nodeId: 'node_eval',
    force: true,
    workspaceSnapshot: {
      path: '/tmp/snapshot',
    },
    requestDaemonRpc: async (input) => {
      calls.push(input);
      return { mode: 'run' };
    },
  });

  assert.deepEqual(calls, [{
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'bridge.submitNodeRun',
    payload: {
      projectId: 'proj_1',
      nodeId: 'node_eval',
      force: true,
      workspaceSnapshot: {
        path: '/tmp/snapshot',
      },
    },
  }]);
});

test('fetchRunContextPackViaDaemon delegates to requestDaemonRpc with the bridge context-pack task', async () => {
  const calls = [];
  await fetchRunContextPackViaDaemon({
    userId: 'czk',
    serverId: 'srv_client_1',
    runId: 'run_123',
    requestDaemonRpc: async (input) => {
      calls.push(input);
      return { mode: 'routed' };
    },
  });

  assert.deepEqual(calls, [{
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchContextPack',
    payload: {
      runId: 'run_123',
    },
  }]);
});

test('fetchRunBridgeReportViaDaemon delegates to requestDaemonRpc with the bridge report task', async () => {
  const calls = [];
  await fetchRunBridgeReportViaDaemon({
    userId: 'czk',
    serverId: 'srv_client_1',
    runId: 'run_123',
    requestDaemonRpc: async (input) => {
      calls.push(input);
      return { runId: 'run_123' };
    },
  });

  assert.deepEqual(calls, [{
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchRunReport',
    payload: {
      runId: 'run_123',
    },
  }]);
});

test('submitRunBridgeNoteViaDaemon delegates to requestDaemonRpc with the bridge note task', async () => {
  const calls = [];
  await submitRunBridgeNoteViaDaemon({
    userId: 'czk',
    serverId: 'srv_client_1',
    runId: 'run_123',
    title: 'Local note',
    content: 'Observed an edge case.',
    requestDaemonRpc: async (input) => {
      calls.push(input);
      return { ok: true };
    },
  });

  assert.deepEqual(calls, [{
    userId: 'czk',
    serverId: 'srv_client_1',
    taskType: 'bridge.submitRunNote',
    payload: {
      runId: 'run_123',
      title: 'Local note',
      content: 'Observed an edge case.',
    },
  }]);
});
