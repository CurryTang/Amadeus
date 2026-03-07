'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunTreePayload } = require('../run-tree-payload.service');

test('buildRunTreePayload normalizes tree runs recursively', () => {
  const payload = buildRunTreePayload({
    roots: [{
      id: 'run_parent',
      projectId: 'proj_1',
      serverId: 'local-default',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      metadata: {
        treeNodeId: 'node_parent',
        treeNodeTitle: 'Parent node',
      },
      children: [{
        id: 'run_child',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        provider: 'codex',
        runType: 'AGENT',
        status: 'SUCCEEDED',
        contextRefs: {
          continueRunIds: ['run_parent'],
        },
        metadata: {
          parentRunId: 'run_parent',
          continuationPhase: 'analysis',
          branchLabel: 'ablation-b',
        },
      }],
    }],
    total: 2,
  });

  assert.equal(payload.total, 2);
  assert.equal(payload.tree.length, 1);
  assert.equal(payload.tree[0].attempt.treeNodeId, 'node_parent');
  assert.equal(payload.tree[0].children.length, 1);
  assert.deepEqual(payload.tree[0].children[0].followUp, {
    parentRunId: 'run_parent',
    continuationOfRunId: null,
    continuationPhase: 'analysis',
    branchLabel: 'ablation-b',
    relatedRunIds: ['run_parent'],
    isContinuation: true,
  });
  assert.equal(payload.tree[0].children[0].execution.serverId, 'srv_remote_1');
});
