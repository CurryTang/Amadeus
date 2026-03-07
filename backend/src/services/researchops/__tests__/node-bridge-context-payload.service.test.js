'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNodeBridgeContextPayload } = require('../node-bridge-context-payload.service');

test('buildNodeBridgeContextPayload exposes current node, blocking, last run, and context pack views', () => {
  const payload = buildNodeBridgeContextPayload({
    projectId: 'proj_1',
    node: {
      id: 'node_eval',
      title: 'Evaluation branch',
      kind: 'experiment',
      checks: [{ type: 'manual_approve', name: 'scope_review' }],
    },
    nodeState: {
      status: 'BLOCKED',
      manualApproved: false,
      lastRunId: 'run_eval',
    },
    blocking: {
      blocked: true,
      blockedBy: [{ type: 'manual_approve', check: 'scope_review', status: 'PENDING' }],
    },
    run: {
      id: 'run_eval',
      projectId: 'proj_1',
      serverId: 'srv_remote_1',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      metadata: {
        treeNodeId: 'node_eval',
        treeNodeTitle: 'Evaluation branch',
        parentRunId: 'run_base',
      },
    },
    contextPack: {
      view: {
        projectId: 'proj_1',
        runId: 'run_eval',
        groups: [{ id: 'grp_1' }],
        selectedItems: [{ id: 'doc_1' }],
      },
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_eval');
  assert.equal(payload.capabilities.hasLastRun, true);
  assert.equal(payload.capabilities.hasContextPack, true);
  assert.equal(payload.blocking.blocked, true);
  assert.equal(payload.lastRun.attempt.treeNodeId, 'node_eval');
  assert.equal(payload.lastRun.followUp.parentRunId, 'run_base');
  assert.equal(payload.contextPack.view.runId, 'run_eval');
});
