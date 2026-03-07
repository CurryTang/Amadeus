'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readBridgeContextOptions,
  readBridgeRunOptions,
} = require('../bridge-route-options.service');

test('readBridgeContextOptions normalizes include flags from query strings', () => {
  const options = readBridgeContextOptions({
    includeContextPack: 'true',
    includeReport: '1',
  });

  assert.deepEqual(options, {
    includeContextPack: true,
    includeReport: true,
  });
});

test('readBridgeRunOptions normalizes body fields for bridge-submitted runs', () => {
  const options = readBridgeRunOptions({
    force: 'true',
    preflightOnly: 1,
    searchTrialCount: '7',
    clarifyMessages: [{ role: 'user', content: 'use seed 4' }],
    workspaceSnapshot: {
      path: '/tmp/researchops-runs/run_bridge',
      sourceServerId: 'srv_remote_1',
    },
    localSnapshot: {
      kind: 'workspace_patch',
      note: 'local edits staged for remote execution',
    },
  });

  assert.deepEqual(options, {
    force: true,
    preflightOnly: true,
    searchTrialCount: 7,
    clarifyMessages: [{ role: 'user', content: 'use seed 4' }],
    workspaceSnapshot: {
      path: '/tmp/researchops-runs/run_bridge',
      sourceServerId: 'srv_remote_1',
    },
    localSnapshot: {
      kind: 'workspace_patch',
      note: 'local edits staged for remote execution',
    },
  });
});
