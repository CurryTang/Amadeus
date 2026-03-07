'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTreePlanImpactPayload,
  buildTreePlanPayload,
  buildTreePlanValidationPayload,
} = require('../tree-plan-payload.service');

test('buildTreePlanPayload keeps the plan root while exposing plan actions', () => {
  const payload = buildTreePlanPayload({
    projectId: 'proj_1',
    plan: {
      nodes: [{ id: 'root', title: 'Root', kind: 'research' }],
    },
    validation: { valid: true, errors: [], warnings: [] },
    environmentDetected: true,
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.plan.nodes.length, 1);
  assert.equal(payload.environmentDetected, true);
  assert.deepEqual(payload.actions.read, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
  assert.deepEqual(payload.actions.validate, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/plan/validate',
  });
  assert.deepEqual(payload.actions.patch, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/plan/patches',
  });
});

test('buildTreePlanValidationPayload preserves valid and validation summary', () => {
  const payload = buildTreePlanValidationPayload({
    projectId: 'proj_1',
    plan: { nodes: [] },
    validation: { valid: false, errors: [{ message: 'bad' }], warnings: [] },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.valid, false);
  assert.equal(payload.validation.errors.length, 1);
  assert.deepEqual(payload.actions.read, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
});

test('buildTreePlanImpactPayload keeps previewPlan while exposing impact actions', () => {
  const payload = buildTreePlanImpactPayload({
    projectId: 'proj_1',
    previewPlan: { nodes: [{ id: 'n1' }] },
    validation: { valid: true, errors: [], warnings: [] },
    impact: { changedNodes: ['n1'] },
    applied: [{ op: 'add_node' }],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.previewPlan.nodes.length, 1);
  assert.deepEqual(payload.actions.patch, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/plan/patches',
  });
  assert.deepEqual(payload.actions.impactPreview, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/plan/impact-preview',
  });
});
