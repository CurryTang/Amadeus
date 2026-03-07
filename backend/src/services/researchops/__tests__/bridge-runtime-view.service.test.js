'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeRuntimeView } = require('../bridge-runtime-view.service');

test('buildBridgeRuntimeView normalizes supported task capabilities', () => {
  const runtime = buildBridgeRuntimeView({
    executionTarget: 'client-daemon',
    serverId: 'srv_client_1',
    supportsLocalBridgeWorkflow: false,
    missingBridgeTaskTypes: ['bridge.fetchRunReport', 'bridge.submitRunNote'],
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
  assert.deepEqual(runtime.capabilities, {
    canFetchNodeContext: true,
    canFetchContextPack: true,
    canSubmitNodeRun: true,
    canFetchRunReport: false,
    canSubmitRunNote: false,
    canCaptureWorkspaceSnapshot: false,
  });
});
