'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRunDeletePayload,
  buildProjectRunClearPayload,
  buildRunEventMutationPayload,
} = require('../run-mutation-payload.service');

test('buildRunDeletePayload exposes run deletion result and follow-up actions', () => {
  const payload = buildRunDeletePayload({
    runId: 'run_1',
    deleted: true,
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.deleted, true);
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
  assert.deepEqual(payload.actions.deleteRun, {
    method: 'DELETE',
    path: '/researchops/runs/run_1',
  });
});

test('buildProjectRunClearPayload preserves deletion count and status filter', () => {
  const payload = buildProjectRunClearPayload({
    projectId: 'proj_1',
    status: 'FAILED',
    result: {
      deletedCount: 3,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.filters.status, 'FAILED');
  assert.equal(payload.deletedCount, 3);
  assert.deepEqual(payload.actions.clear, {
    method: 'DELETE',
    path: '/researchops/projects/proj_1/runs',
  });
});

test('buildRunEventMutationPayload normalizes event mutations while keeping event items compatible', () => {
  const payload = buildRunEventMutationPayload({
    runId: 'run_1',
    result: {
      items: [
        {
          id: 'evt_1',
          runId: 'run_1',
          sequence: 1,
          eventType: 'LOG_LINE',
          status: 'running',
          message: 'started',
          progress: 10,
          payload: { source: 'runner' },
          timestamp: '2026-03-06T12:00:00.000Z',
        },
      ],
    },
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.count, 1);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'evt_1');
  assert.equal(payload.items[0].status, 'RUNNING');
  assert.deepEqual(payload.actions.events, {
    method: 'GET',
    path: '/researchops/runs/run_1/events',
  });
  assert.deepEqual(payload.actions.publishEvents, {
    method: 'POST',
    path: '/researchops/runs/run_1/events',
  });
});
