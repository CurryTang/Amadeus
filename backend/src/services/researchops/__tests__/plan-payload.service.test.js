'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGeneratedPlanPayload,
  buildEnqueuedPlanPayload,
} = require('../plan-payload.service');

test('buildGeneratedPlanPayload preserves plan roots while exposing follow-up actions', () => {
  const payload = buildGeneratedPlanPayload({
    plan: {
      plan_id: 'plan_1',
      instruction_type: 'todo_dsl',
    },
    todoCandidates: [{ id: 'todo_1', title: 'Step 1' }],
    todoDsl: { steps: [{ id: 'todo_1' }] },
    referenceSummary: { sourceCount: 3 },
  });

  assert.equal(payload.plan.plan_id, 'plan_1');
  assert.equal(payload.todoCandidates.length, 1);
  assert.equal(payload.todoDsl.steps.length, 1);
  assert.equal(payload.referenceSummary.sourceCount, 3);
  assert.deepEqual(payload.actions.generate, {
    method: 'POST',
    path: '/researchops/plan/generate',
  });
  assert.deepEqual(payload.actions.enqueueV2, {
    method: 'POST',
    path: '/researchops/plan/enqueue-v2',
  });
});

test('buildEnqueuedPlanPayload preserves plan and adds run follow-up views', () => {
  const payload = buildEnqueuedPlanPayload({
    plan: {
      plan_id: 'plan_1',
    },
    run: {
      id: 'run_1',
      projectId: 'proj_1',
      status: 'QUEUED',
    },
  });

  assert.equal(payload.plan.plan_id, 'plan_1');
  assert.equal(payload.run.id, 'run_1');
  assert.equal(payload.attempt.runId, 'run_1');
  assert.deepEqual(payload.actions.enqueueV2, {
    method: 'POST',
    path: '/researchops/plan/enqueue-v2',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});
