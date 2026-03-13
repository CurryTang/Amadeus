'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTreeNodeApprovalPayload,
  buildGeneratedTreeNodePayload,
} = require('../tree-node-action-payload.service');

test('buildTreeNodeApprovalPayload preserves approval roots while exposing node actions', () => {
  const payload = buildTreeNodeApprovalPayload({
    projectId: 'proj_1',
    nodeId: 'node_1',
    manualApproved: true,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_1');
  assert.equal(payload.manualApproved, true);
  assert.deepEqual(payload.actions.approve, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/approve',
  });
  assert.deepEqual(payload.actions.judge, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/judge',
  });
  assert.deepEqual(payload.actions.judgeApprove, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/judge/approve',
  });
  assert.deepEqual(payload.actions.judgeRetry, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/judge/retry',
  });
});

test('buildGeneratedTreeNodePayload preserves node/provider roots while exposing generation actions', () => {
  const payload = buildGeneratedTreeNodePayload({
    projectId: 'proj_1',
    node: {
      id: 'node_1',
      title: 'Investigate issue',
    },
    provider: 'codex_cli',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.node.id, 'node_1');
  assert.equal(payload.provider, 'codex_cli');
  assert.deepEqual(payload.actions.generate, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/from-todo',
  });
  assert.deepEqual(payload.actions.clarify, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/from-todo/clarify',
  });
});
