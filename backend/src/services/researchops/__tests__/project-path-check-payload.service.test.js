'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectPathCheckPayload } = require('../project-path-check-payload.service');

test('buildProjectPathCheckPayload preserves path-check roots while exposing actions', () => {
  const payload = buildProjectPathCheckPayload({
    locationType: 'local',
    serverId: 'local-default',
    projectPath: '/repo',
    exists: true,
    isDirectory: true,
    canCreate: true,
    viaProxy: true,
    message: 'Path exists and is a directory.',
  });

  assert.equal(payload.locationType, 'local');
  assert.equal(payload.serverId, 'local-default');
  assert.equal(payload.projectPath, '/repo');
  assert.equal(payload.exists, true);
  assert.equal(payload.viaProxy, true);
  assert.equal(payload.message, 'Path exists and is a directory.');
  assert.deepEqual(payload.actions.checkPath, {
    method: 'POST',
    path: '/researchops/projects/path-check',
  });
});
