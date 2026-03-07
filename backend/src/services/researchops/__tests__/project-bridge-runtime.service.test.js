'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectBridgeRuntime } = require('../project-bridge-runtime.service');

test('buildProjectBridgeRuntime derives bridge readiness for client agent projects', () => {
  const runtime = buildProjectBridgeRuntime({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  }, {
    id: 'srv_client_1',
    supportedTaskTypes: [
      'project.checkPath',
      'project.ensurePath',
      'project.ensureGit',
      'bridge.fetchNodeContext',
      'bridge.fetchContextPack',
      'bridge.submitNodeRun',
    ],
  });

  assert.equal(runtime.executionTarget, 'client-daemon');
  assert.equal(runtime.serverId, 'srv_client_1');
  assert.equal(runtime.supportsLocalBridgeWorkflow, false);
  assert.deepEqual(runtime.missingBridgeTaskTypes, [
    'bridge.fetchRunReport',
    'bridge.submitRunNote',
  ]);
});
