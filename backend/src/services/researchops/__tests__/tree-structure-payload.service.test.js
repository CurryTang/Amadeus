'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTreeRootNodePayload,
  buildTreeStatePayload,
} = require('../tree-structure-payload.service');

test('buildTreeRootNodePayload preserves root-node generation roots and actions', () => {
  const payload = buildTreeRootNodePayload({
    projectId: 'proj_1',
    generated: true,
    rootNode: { id: 'root', title: 'Root' },
    summary: { attached: 3 },
    achievements: [{ id: 'ach_1' }],
    snapshot: { nodeCount: 4 },
    plan: { nodes: [{ id: 'root' }] },
    validation: { valid: true, errors: [], warnings: [] },
    degraded: null,
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.generated, true);
  assert.equal(payload.rootNode.id, 'root');
  assert.equal(payload.plan.nodes.length, 1);
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.rootNode, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/root-node',
  });
  assert.deepEqual(payload.actions.plan, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
});

test('buildTreeStatePayload preserves state roots and actions', () => {
  const payload = buildTreeStatePayload({
    projectId: 'proj_1',
    state: {
      nodes: {
        node_1: { status: 'RUNNING' },
      },
    },
    paths: {
      statePath: '/repo/research/tree.state.json',
    },
    degraded: null,
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.state.nodes.node_1.status, 'RUNNING');
  assert.equal(payload.paths.statePath, '/repo/research/tree.state.json');
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.state, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/state',
  });
  assert.deepEqual(payload.actions.plan, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
});
