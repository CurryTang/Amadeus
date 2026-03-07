'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKbSyncJobPayload,
  buildKbSyncJobAcceptedPayload,
} = require('../kb-sync-job-payload.service');

test('buildKbSyncJobPayload preserves job root while exposing follow-up actions', () => {
  const payload = buildKbSyncJobPayload({
    projectId: 'proj_1',
    job: {
      id: 'kbjob_1',
      status: 'RUNNING',
      groupId: 42,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.jobId, 'kbjob_1');
  assert.equal(payload.job.id, 'kbjob_1');
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/projects/proj_1/kb/sync-jobs/kbjob_1',
  });
});

test('buildKbSyncJobAcceptedPayload preserves accepted/message while exposing start/detail actions', () => {
  const payload = buildKbSyncJobAcceptedPayload({
    projectId: 'proj_1',
    message: 'KB sync started in background',
    job: {
      id: 'kbjob_1',
      status: 'QUEUED',
      groupId: 42,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.accepted, true);
  assert.equal(payload.message, 'KB sync started in background');
  assert.equal(payload.job.id, 'kbjob_1');
  assert.deepEqual(payload.actions.start, {
    method: 'POST',
    path: '/researchops/projects/proj_1/kb/sync-group',
  });
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/projects/proj_1/kb/sync-jobs/kbjob_1',
  });
});
