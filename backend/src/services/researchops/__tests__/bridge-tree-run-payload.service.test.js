'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeTreeRunPayload } = require('../bridge-tree-run-payload.service');

test('buildBridgeTreeRunPayload exposes run semantics for bridge-submitted tree runs', () => {
  const payload = buildBridgeTreeRunPayload({
    projectId: 'proj_1',
    nodeId: 'node_eval',
    bridgeRuntime: {
      executionTarget: 'client-daemon',
      serverId: 'srv_client_1',
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
    result: {
      mode: 'run',
      run: {
        id: 'run_123',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        runType: 'EXPERIMENT',
        status: 'QUEUED',
        outputContract: {
          requiredArtifacts: ['metrics', 'table'],
        },
        metadata: {
          treeNodeId: 'node_eval',
          treeNodeTitle: 'Evaluation branch',
          parentRunId: 'run_base',
        },
      },
      blockedBy: [],
      contextPack: {
        generatedAt: '2026-03-06T12:00:00.000Z',
      },
    },
  });

  assert.equal(payload.bridgeVersion, 'v0');
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_eval');
  assert.equal(payload.mode, 'run');
  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'node_eval');
  assert.equal(payload.execution.serverId, 'srv_remote_1');
  assert.equal(payload.followUp.parentRunId, 'run_base');
  assert.deepEqual(payload.contract.requiredArtifacts, ['metrics', 'table']);
  assert.equal(payload.bridgeRuntime.executionTarget, 'client-daemon');
  assert.equal(payload.bridgeRuntime.serverId, 'srv_client_1');
  assert.equal(payload.bridgeRuntime.supportsLocalBridgeWorkflow, true);
  assert.equal(payload.bridgeRuntime.capabilities.canFetchNodeContext, true);
  assert.equal(payload.bridgeRuntime.capabilities.canFetchContextPack, true);
  assert.equal(payload.bridgeRuntime.capabilities.canSubmitNodeRun, true);
  assert.equal(payload.bridgeRuntime.capabilities.canFetchRunReport, true);
  assert.equal(payload.bridgeRuntime.capabilities.canSubmitRunNote, true);
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
  assert.deepEqual(payload.taskActions.fetchRunReport, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchRunReport',
    payload: {
      runId: 'run_123',
    },
  });
  assert.deepEqual(payload.taskActions.submitRunNote, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.submitRunNote',
    payload: {
      runId: 'run_123',
    },
  });
  assert.deepEqual(payload.contextPack, {
    generatedAt: '2026-03-06T12:00:00.000Z',
  });
});

test('buildBridgeTreeRunPayload preserves preflight preview without fabricating run data', () => {
  const payload = buildBridgeTreeRunPayload({
    projectId: 'proj_1',
    nodeId: 'node_eval',
    result: {
      mode: 'preflight',
      runPayloadPreview: {
        runType: 'EXPERIMENT',
        serverId: 'srv_remote_1',
        outputContract: {
          requiredArtifacts: ['metrics'],
        },
        metadata: {
          jobSpec: {
            backend: 'container',
          },
        },
      },
    },
  });

  assert.equal(payload.mode, 'preflight');
  assert.deepEqual(payload.runPayloadPreview, {
    runType: 'EXPERIMENT',
    serverId: 'srv_remote_1',
    outputContract: {
      requiredArtifacts: ['metrics'],
    },
    metadata: {
      jobSpec: {
        backend: 'container',
      },
    },
  });
  assert.equal(payload.runPreview.execution.backend, 'container');
  assert.deepEqual(payload.runPreview.contract.requiredArtifacts, ['metrics']);
  assert.equal('run' in payload, false);
});
