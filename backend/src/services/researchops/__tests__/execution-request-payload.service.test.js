'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExecutionRequestPayload } = require('../execution-request-payload.service');

test('buildExecutionRequestPayload normalizes daemon-facing execution request fields', () => {
  const run = {
    id: ' run_exec_123 ',
    projectId: ' proj_9 ',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'queued',
    metadata: {
      treeNodeId: 'node_alpha',
      treeNodeTitle: 'Node Alpha',
      runSource: 'tree-run',
      cwdSourceServerId: 'srv_sync_1',
      workspaceSnapshot: {
        path: ' /tmp/execution-workspace ',
        sourceServerId: 'srv_snapshot_1',
        runSpecArtifactId: 'artifact_spec_1',
      },
      localSnapshot: {
        kind: 'workspace_patch',
        note: 'dirty tree staged for execution',
      },
      jobSpec: {
        backend: 'docker',
        runtimeClass: 'fast',
        resources: {
          cpu: '8',
          gpu: '1',
          ramGb: '32',
          timeoutMin: '45',
        },
      },
    },
    outputContract: {
      requiredArtifacts: ['metrics', 'table', '', 'metrics'],
      tables: ['summary_table', 'summary_table'],
      figures: ['loss_curve'],
      metricKeys: ['accuracy', 'loss', 'accuracy'],
      summaryRequired: 1,
    },
    contextRefs: {
      continueRunIds: ['run_base_1'],
      compareRunIds: ['run_alt_1', ''],
    },
  };

  const payload = buildExecutionRequestPayload({ run });

  assert.equal(payload.runId, 'run_exec_123');
  assert.equal(payload.projectId, 'proj_9');
  assert.deepEqual(payload.attempt, {
    id: 'run_exec_123',
    runId: 'run_exec_123',
    projectId: 'proj_9',
    nodeId: 'node_alpha',
    treeNodeId: 'node_alpha',
    treeNodeTitle: 'Node Alpha',
    status: 'QUEUED',
    provider: 'codex',
    runType: 'AGENT',
    runSource: 'tree-run',
    createdAt: '',
    startedAt: '',
    endedAt: '',
  });
  assert.deepEqual(payload.workspaceSnapshot, {
    path: '/tmp/execution-workspace',
    sourceServerId: 'srv_snapshot_1',
    runSpecArtifactId: 'artifact_spec_1',
    localSnapshot: {
      kind: 'workspace_patch',
      note: 'dirty tree staged for execution',
    },
  });
  assert.deepEqual(payload.envSnapshot, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 8,
      gpu: 1,
      ramGb: 32,
      timeoutMin: 45,
    },
  });
  assert.deepEqual(payload.jobSpec, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 8,
      gpu: 1,
      ramGb: 32,
      timeoutMin: 45,
    },
  });
  assert.deepEqual(payload.outputContract, {
    requiredArtifacts: ['metrics', 'table'],
    tables: ['summary_table'],
    figures: ['loss_curve'],
    metricKeys: ['accuracy', 'loss'],
    summaryRequired: true,
  });
  assert.deepEqual(payload.contextRefs, {
    continueRunIds: ['run_base_1'],
    compareRunIds: ['run_alt_1'],
  });
});
