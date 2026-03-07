'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQueuedTreeRunAllItem,
  buildTreeRunAllPayload,
} = require('../tree-run-all-payload.service');

test('buildQueuedTreeRunAllItem adds attempt semantics for queued run items', () => {
  const item = buildQueuedTreeRunAllItem({
    nodeId: 'baseline_root',
    result: {
      mode: 'run',
      run: {
        id: 'run_123',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        provider: 'codex',
        status: 'QUEUED',
        outputContract: {
          requiredArtifacts: ['metrics'],
        },
        metadata: {
          treeNodeId: 'baseline_root',
          treeNodeTitle: 'Baseline Root',
          runSource: 'run-all',
          parentRunId: 'run_base',
          jobSpec: {
            backend: 'container',
          },
        },
      },
    },
  });

  assert.equal(item.nodeId, 'baseline_root');
  assert.equal(item.mode, 'run');
  assert.equal(item.runId, 'run_123');
  assert.equal(item.attemptId, 'run_123');
  assert.equal(item.attempt.treeNodeId, 'baseline_root');
  assert.equal(item.execution.backend, 'container');
  assert.equal(item.followUp.parentRunId, 'run_base');
  assert.deepEqual(item.contract.requiredArtifacts, ['metrics']);
});

test('buildTreeRunAllPayload preserves summary and leaves non-run items lightweight', () => {
  const payload = buildTreeRunAllPayload({
    projectId: 'proj_1',
    scope: 'active_path',
    fromNodeId: '',
    queued: [
      buildQueuedTreeRunAllItem({
        nodeId: 'node_search',
        result: {
          mode: 'search',
          search: {
            trials: [{ id: 'trial_1' }],
          },
        },
      }),
    ],
    blocked: [{ nodeId: 'node_blocked', blockedBy: ['dep_a'] }],
    summary: {
      scopedNodes: 2,
      queued: 1,
      blocked: 1,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.scope, 'active_path');
  assert.equal(payload.fromNodeId, null);
  assert.equal(payload.queued[0].nodeId, 'node_search');
  assert.equal(payload.queued[0].mode, 'search');
  assert.equal('attempt' in payload.queued[0], false);
  assert.deepEqual(payload.summary, {
    scopedNodes: 2,
    queued: 1,
    blocked: 1,
  });
});
