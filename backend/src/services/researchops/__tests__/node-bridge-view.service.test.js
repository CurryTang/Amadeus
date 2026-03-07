'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNodeBridgeView } = require('../node-bridge-view.service');

test('buildNodeBridgeView can inline bridge report when run evidence is provided', () => {
  const payload = buildNodeBridgeView({
    projectId: 'proj_1',
    node: {
      id: 'node_eval',
      title: 'Evaluation branch',
    },
    nodeState: {
      status: 'RUNNING',
      lastRunId: 'run_eval',
    },
    blocking: {
      blocked: false,
      blockedBy: [],
    },
    run: {
      id: 'run_eval',
      projectId: 'proj_1',
      status: 'SUCCEEDED',
      serverId: 'srv_remote_1',
      metadata: {
        treeNodeId: 'node_eval',
        treeNodeTitle: 'Evaluation branch',
        localSnapshot: {
          kind: 'workspace_patch',
          note: 'local edits staged for remote execution',
        },
      },
    },
    contextPack: {
      view: {
        runId: 'run_eval',
      },
    },
    bridgeRuntime: {
      executionTarget: 'client-daemon',
      supportsLocalBridgeWorkflow: true,
      missingBridgeTaskTypes: [],
      supportedTaskTypes: [
        'project.checkPath',
        'project.ensurePath',
        'project.ensureGit',
        'bridge.fetchNodeContext',
        'bridge.fetchContextPack',
        'bridge.submitNodeRun',
        'bridge.fetchRunReport',
        'bridge.submitRunNote',
      ],
    },
    reportArtifacts: [{ id: 'art_summary', kind: 'run_summary_md' }],
    reportCheckpoints: [{ id: 'chk_1', status: 'PENDING' }],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.lastRun.run.id, 'run_eval');
  assert.equal(payload.bridgeReport.runId, 'run_eval');
  assert.equal(payload.bridgeReport.counts.artifacts, 1);
  assert.equal(payload.bridgeReport.counts.pendingCheckpoints, 1);
  assert.equal(payload.capabilities.hasBridgeReport, true);
  assert.equal(payload.capabilities.hasWorkspaceSnapshot, true);
  assert.equal(payload.capabilities.hasLocalSnapshot, true);
  assert.equal(payload.capabilities.canUseLocalBridgeWorkflow, true);
});
