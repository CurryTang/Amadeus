'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { dispatchBridgeTransport } = require('../bridge-route-dispatch.service');

test('dispatchBridgeTransport routes daemon-task transport through the daemon executor', async () => {
  const calls = [];
  const result = await dispatchBridgeTransport({
    transport: 'daemon-task',
    bridgeRuntime: {
      serverId: 'srv_client_1',
      supportsLocalBridgeWorkflow: true,
      missingBridgeTaskTypes: [],
    },
    viaDaemon: async ({ serverId }) => {
      calls.push({ mode: 'daemon', serverId });
      return { ok: true, serverId };
    },
    viaHttp: async () => {
      calls.push({ mode: 'http' });
      return { ok: false };
    },
  });

  assert.deepEqual(result, { ok: true, serverId: 'srv_client_1' });
  assert.deepEqual(calls, [{ mode: 'daemon', serverId: 'srv_client_1' }]);
});

test('dispatchBridgeTransport falls back to http transport by default', async () => {
  const calls = [];
  const result = await dispatchBridgeTransport({
    transport: '',
    bridgeRuntime: null,
    viaDaemon: async () => {
      calls.push({ mode: 'daemon' });
      return { ok: false };
    },
    viaHttp: async () => {
      calls.push({ mode: 'http' });
      return { ok: true };
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [{ mode: 'http' }]);
});

test('dispatchBridgeTransport rejects daemon-task transport when bridge runtime is not ready', async () => {
  await assert.rejects(() => dispatchBridgeTransport({
    transport: 'daemon-task',
    bridgeRuntime: {
      serverId: 'srv_client_1',
      supportsLocalBridgeWorkflow: false,
      missingBridgeTaskTypes: ['bridge.submitRunNote'],
    },
    viaDaemon: async () => ({ ok: true }),
    viaHttp: async () => ({ ok: true }),
  }), /bridge\.submitRunNote/i);
});
