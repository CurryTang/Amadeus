'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBridgeTransportEnum,
  readBridgeTransportMode,
  listBridgeTransportModes,
  selectPreferredBridgeTransport,
  assertBridgeDaemonTransportReady,
} = require('../bridge-transport.service');

test('readBridgeTransportMode defaults to http and accepts daemon-task and rust-daemon', () => {
  assert.equal(readBridgeTransportMode(undefined), 'http');
  assert.equal(readBridgeTransportMode('daemon-task'), 'daemon-task');
  assert.equal(readBridgeTransportMode(' DAEMON-TASK '), 'daemon-task');
  assert.equal(readBridgeTransportMode('rust-daemon'), 'rust-daemon');
});

test('assertBridgeDaemonTransportReady returns server id when runtime is ready', () => {
  assert.equal(assertBridgeDaemonTransportReady({
    executionTarget: 'client-daemon',
    serverId: 'srv_client_1',
    supportsLocalBridgeWorkflow: true,
  }), 'srv_client_1');
});

test('assertBridgeDaemonTransportReady throws when runtime is missing bridge support', () => {
  assert.throws(() => assertBridgeDaemonTransportReady({
    executionTarget: 'client-daemon',
    serverId: 'srv_client_1',
    supportsLocalBridgeWorkflow: false,
    missingBridgeTaskTypes: ['bridge.fetchRunReport'],
  }), /does not support local bridge workflow/i);
});

test('bridge transport helpers surface daemon and rust transport options', () => {
  const bridgeRuntime = {
    serverId: 'srv_client_1',
    supportsLocalBridgeWorkflow: true,
  };
  const env = {
    RESEARCHOPS_RUST_DAEMON_URL: 'http://127.0.0.1:7788',
  };

  assert.deepEqual(listBridgeTransportModes({ bridgeRuntime, env }), ['http', 'daemon-task', 'rust-daemon']);
  assert.equal(buildBridgeTransportEnum({ bridgeRuntime, env }), '"http"|"daemon-task"|"rust-daemon"');
  assert.equal(selectPreferredBridgeTransport({ bridgeRuntime, env }), 'daemon-task');
});
