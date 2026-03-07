'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRunCheckpointDecisionPayload,
  buildRunCheckpointListPayload,
} = require('../run-checkpoint-payload.service');

test('buildRunCheckpointListPayload normalizes checkpoint items and filters', () => {
  const payload = buildRunCheckpointListPayload({
    runId: 'run_1',
    status: 'pending',
    items: [
      {
        id: 'cp_1',
        runId: 'run_1',
        status: 'pending',
        message: 'Need approval',
      },
    ],
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.filters.status, 'pending');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'PENDING');
  assert.deepEqual(payload.items[0].actions.decide, {
    method: 'POST',
    path: '/researchops/runs/run_1/checkpoints/cp_1/decision',
  });
});

test('buildRunCheckpointDecisionPayload preserves checkpoint root while exposing list action', () => {
  const payload = buildRunCheckpointDecisionPayload({
    runId: 'run_1',
    checkpoint: {
      id: 'cp_2',
      runId: 'run_1',
      status: 'approved',
      decision: {
        action: 'APPROVED',
      },
    },
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.checkpoint.id, 'cp_2');
  assert.equal(payload.checkpoint.status, 'APPROVED');
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/runs/run_1/checkpoints',
  });
});
