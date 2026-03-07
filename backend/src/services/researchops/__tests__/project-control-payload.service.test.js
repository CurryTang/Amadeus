'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectKbSetupPayload,
  buildProjectGitRestorePayload,
} = require('../project-control-payload.service');

test('buildProjectKbSetupPayload preserves project and inspection roots while exposing actions', () => {
  const payload = buildProjectKbSetupPayload({
    projectId: 'proj_1',
    message: 'resource/ folder validated and linked as project KB',
    inspection: {
      exists: true,
      valid: true,
      resourcePath: '/repo/resource',
    },
    project: {
      id: 'proj_1',
      kbFolderPath: '/repo/resource',
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.message, 'resource/ folder validated and linked as project KB');
  assert.equal(payload.project.id, 'proj_1');
  assert.equal(payload.inspection.resourcePath, '/repo/resource');
  assert.deepEqual(payload.actions.setupFromResource, {
    method: 'POST',
    path: '/researchops/projects/proj_1/kb/setup-from-resource',
  });
});

test('buildProjectGitRestorePayload preserves branch/commit roots while exposing actions', () => {
  const payload = buildProjectGitRestorePayload({
    projectId: 'proj_1',
    runId: 'run_1',
    branch: 'restore/run-1',
    commit: 'abc123',
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.branch, 'restore/run-1');
  assert.equal(payload.commit, 'abc123');
  assert.deepEqual(payload.actions.restoreRun, {
    method: 'POST',
    path: '/researchops/projects/proj_1/git/restore',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});
