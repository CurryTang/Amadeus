'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readBridgeTransportMode,
  assertBridgeDaemonTransportReady,
} = require('../bridge-transport.service');

test('readBridgeTransportMode defaults to http and accepts daemon-task', () => {
  assert.equal(readBridgeTransportMode(undefined), 'http');
  assert.equal(readBridgeTransportMode('daemon-task'), 'daemon-task');
  assert.equal(readBridgeTransportMode(' DAEMON-TASK '), 'daemon-task');
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
