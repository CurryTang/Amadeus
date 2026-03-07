'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProjectLocationPayload,
  deriveProjectCapabilities,
} = require('../project-location.service');

test('normalizes client agent projects with clientDeviceId and path', () => {
  const result = normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  });

  assert.equal(result.locationType, 'client');
  assert.equal(result.clientMode, 'agent');
  assert.equal(result.clientDeviceId, 'srv_client_1');
  assert.equal(result.serverId, 'srv_client_1');
  assert.equal(result.projectPath, '/Users/alice/my-project');
});

test('rejects browser client projects that include serverId', () => {
  assert.throws(() => normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
    serverId: 'local-default',
  }), /serverId must not be set/i);
});

test('derives browser client capabilities as non-executable', () => {
  const caps = deriveProjectCapabilities({
    locationType: 'client',
    clientMode: 'browser',
  });

  assert.equal(caps.canExecute, false);
  assert.equal(caps.canGitInit, false);
  assert.equal(caps.requiresBrowserWorkspaceLink, true);
});

test('derives client agent capabilities as daemon-backed execution flow', () => {
  const caps = deriveProjectCapabilities({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  });

  assert.equal(caps.canExecute, true);
  assert.equal(caps.executionTarget, 'client-daemon');
  assert.equal(caps.supportsLocalBridgeWorkflow, true);
  assert.deepEqual(caps.daemonTaskTypes, [
    'project.checkPath',
    'project.ensurePath',
    'project.ensureGit',
  ]);
});
