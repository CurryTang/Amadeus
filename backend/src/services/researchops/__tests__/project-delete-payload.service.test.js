'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectDeletePayload } = require('../project-delete-payload.service');

test('buildProjectDeletePayload preserves delete roots and exposes follow-up actions', () => {
  const payload = buildProjectDeletePayload({
    projectId: 'proj_1',
    force: true,
    deleteStorage: false,
    summary: {
      deletedRunCount: 4,
      deletedProject: true,
    },
  });

  assert.equal(payload.success, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.force, true);
  assert.equal(payload.deleteStorage, false);
  assert.equal(payload.summary.deletedRunCount, 4);
  assert.deepEqual(payload.actions.listProjects, {
    method: 'GET',
    path: '/researchops/projects',
  });
  assert.deepEqual(payload.actions.createProject, {
    method: 'POST',
    path: '/researchops/projects',
  });
});
