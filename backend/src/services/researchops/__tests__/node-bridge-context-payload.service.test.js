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
    bridgeReport: {
      bridgeVersion: 'v0',
      runId: 'run_eval',
      status: 'SUCCEEDED',
      flags: {
        hasContractFailures: true,
      },
      snapshots: {
        workspace: {
          path: '/tmp/researchops-runs/run_eval',
          localSnapshot: {
            kind: 'workspace_patch',
            note: 'local edits staged for remote execution',
          },
        },
        env: {
          backend: 'container',
        },
      },
      counts: {
        artifacts: 2,
        checkpoints: 1,
        pendingCheckpoints: 1,
      },
    },
    bridgeRuntime: {
      executionTarget: 'client-daemon',
      serverId: 'srv_client_1',
      supportsLocalBridgeWorkflow: false,
      missingBridgeTaskTypes: ['bridge.submitNodeRun'],
      supportedTaskTypes: ['project.checkPath', 'project.ensurePath', 'project.ensureGit'],
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
  assert.equal(payload.bridgeReport.runId, 'run_eval');
  assert.equal(payload.capabilities.hasBridgeReport, true);
  assert.equal(payload.capabilities.hasWorkspaceSnapshot, true);
  assert.equal(payload.capabilities.hasLocalSnapshot, true);
  assert.equal(payload.capabilities.hasEnvSnapshot, true);
  assert.equal(payload.capabilities.hasContractFailures, true);
  assert.equal(payload.capabilities.canUseLocalBridgeWorkflow, false);
  assert.deepEqual(payload.capabilities.missingBridgeTaskTypes, ['bridge.submitNodeRun']);
  assert.equal(payload.bridgeRuntime.executionTarget, 'client-daemon');
  assert.equal(payload.bridgeRuntime.serverId, 'srv_client_1');
  assert.equal(payload.bridgeRuntime.capabilities.canFetchNodeContext, false);
  assert.equal(payload.bridgeRuntime.capabilities.canFetchContextPack, false);
  assert.equal(payload.bridgeRuntime.capabilities.canSubmitNodeRun, false);
  assert.equal(payload.bridgeRuntime.capabilities.canFetchRunReport, false);
  assert.equal(payload.bridgeRuntime.capabilities.canSubmitRunNote, false);
  assert.deepEqual(payload.actions.bridgeRun, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_eval/bridge-run',
  });
  assert.deepEqual(payload.taskActions.fetchNodeContext, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchNodeContext',
    payload: {
      projectId: 'proj_1',
      nodeId: 'node_eval',
    },
  });
  assert.deepEqual(payload.taskActions.submitNodeRun, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.submitNodeRun',
    payload: {
      projectId: 'proj_1',
      nodeId: 'node_eval',
    },
  });
  assert.deepEqual(payload.taskActions.fetchContextPack, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchContextPack',
    payload: {
      runId: 'run_eval',
    },
  });
  assert.deepEqual(payload.taskActions.fetchRunReport, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchRunReport',
    payload: {
      runId: 'run_eval',
    },
  });
  assert.deepEqual(payload.taskActions.submitRunNote, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.submitRunNote',
    payload: {
      runId: 'run_eval',
    },
  });
  assert.deepEqual(payload.actions.bridgeContext, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/nodes/node_eval/bridge-context',
  });
  assert.deepEqual(payload.actions.contextPack, {
    method: 'GET',
    path: '/researchops/runs/run_eval/context-pack',
  });
  assert.deepEqual(payload.actions.report, {
    method: 'GET',
    path: '/researchops/runs/run_eval/report',
  });
  assert.deepEqual(payload.actions.artifacts, {
    method: 'GET',
    path: '/researchops/runs/run_eval/artifacts',
  });
  assert.deepEqual(payload.actions.bridgeReport, {
    method: 'GET',
    path: '/researchops/runs/run_eval/bridge-report',
  });
  assert.deepEqual(payload.actions.bridgeNote, {
    method: 'POST',
    path: '/researchops/runs/run_eval/bridge-note',
  });
  assert.deepEqual(payload.submitHints.bridgeContext, {
    query: {
      includeContextPack: 'boolean',
      includeReport: 'boolean',
      transport: '"http"|"daemon-task"',
    },
  });
  assert.deepEqual(payload.submitHints.bridgeRun, {
    body: {
      transport: '"http"|"daemon-task"',
      force: 'boolean',
      preflightOnly: 'boolean',
      searchTrialCount: 'integer(1..64)',
      clarifyMessages: 'array',
      workspaceSnapshot: {
        path: 'string|null',
        sourceServerId: 'string|null',
        runSpecArtifactId: 'string|null',
      },
      localSnapshot: {
        kind: 'string',
        note: 'string',
      },
    },
  });
  assert.deepEqual(payload.submitHints.bridgeNote, {
    body: {
      title: 'string',
      content: 'string',
      noteType: 'string',
    },
  });
});
