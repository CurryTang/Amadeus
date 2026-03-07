'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTreeJumpstartPayload } = require('../tree-jumpstart-payload.service');

test('buildTreeJumpstartPayload preserves jumpstart roots and follow-up actions', () => {
  const payload = buildTreeJumpstartPayload({
    projectId: 'proj_1',
    projectMode: 'new_project',
    nodes: [{ id: 'project_environment', kind: 'setup' }],
    plan: { nodes: [{ id: 'project_environment' }] },
    validation: { valid: true, errors: [], warnings: [] },
    autoRun: { queued: true, nodeId: 'project_environment' },
    autoRunError: null,
    updatedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.projectMode, 'new_project');
  assert.equal(payload.nodes.length, 1);
  assert.equal(payload.plan.nodes.length, 1);
  assert.equal(payload.autoRun.queued, true);
  assert.equal(payload.updatedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.jumpstart, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/jumpstart',
  });
  assert.deepEqual(payload.actions.plan, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
  assert.deepEqual(payload.actions.state, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/state',
  });
});
