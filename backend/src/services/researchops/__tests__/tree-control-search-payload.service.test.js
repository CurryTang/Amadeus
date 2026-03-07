'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTreeQueueControlPayload,
  buildTreeSearchPayload,
  buildTreeSearchPromotionPayload,
} = require('../tree-control-search-payload.service');

test('buildTreeQueueControlPayload preserves queue control roots and actions', () => {
  const payload = buildTreeQueueControlPayload({
    projectId: 'proj_1',
    state: {
      queue: { paused: true },
    },
    paused: true,
    cancelledRunIds: ['run_1'],
    cancelledCount: 1,
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.state.queue.paused, true);
  assert.equal(payload.paused, true);
  assert.equal(payload.cancelledCount, 1);
  assert.equal(payload.cancelledRunIds[0], 'run_1');
  assert.deepEqual(payload.actions.pause, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/control/pause',
  });
  assert.deepEqual(payload.actions.resume, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/control/resume',
  });
});

test('buildTreeSearchPayload preserves search roots and actions', () => {
  const payload = buildTreeSearchPayload({
    projectId: 'proj_1',
    nodeId: 'node_1',
    search: {
      searchNodeId: 'node_1',
      trials: [],
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_1');
  assert.equal(payload.search.searchNodeId, 'node_1');
  assert.deepEqual(payload.actions.search, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/search',
  });
  assert.deepEqual(payload.actions.promoteTrial.pathTemplate, '/researchops/projects/proj_1/tree/nodes/node_1/promote/{trialId}');
});

test('buildTreeSearchPromotionPayload preserves promote roots and actions', () => {
  const payload = buildTreeSearchPromotionPayload({
    projectId: 'proj_1',
    nodeId: 'node_1',
    trialId: 'trial_1',
    promotedNodeId: 'node_promoted',
    plan: { nodes: [{ id: 'node_promoted' }] },
    impact: { changedNodes: ['node_promoted'] },
    validation: { valid: true, errors: [], warnings: [] },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_1');
  assert.equal(payload.trialId, 'trial_1');
  assert.equal(payload.promotedNodeId, 'node_promoted');
  assert.equal(payload.plan.nodes.length, 1);
  assert.deepEqual(payload.actions.search, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/search',
  });
  assert.deepEqual(payload.actions.promoteTrial, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/promote/trial_1',
  });
});
