'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeRunReportPayload } = require('../bridge-run-report-payload.service');

test('buildBridgeRunReportPayload exposes bridge-friendly current run summary fields', () => {
  const previousRustUrl = process.env.RESEARCHOPS_RUST_DAEMON_URL;
  process.env.RESEARCHOPS_RUST_DAEMON_URL = 'http://127.0.0.1:7788';
  try {
  const payload = buildBridgeRunReportPayload({
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
    report: {
      run: {
        id: 'run_123',
        projectId: 'proj_1',
        status: 'SUCCEEDED',
      },
      attempt: {
        id: 'run_123',
        treeNodeId: 'node_eval',
      },
      execution: {
        serverId: 'srv_remote_1',
        location: 'remote',
        backend: 'container',
      },
      followUp: {
        parentRunId: 'run_parent',
        continuationPhase: 'analysis',
        branchLabel: null,
        relatedRunIds: ['run_parent', 'run_alt'],
        isContinuation: true,
      },
      contract: {
        requiredArtifacts: ['metrics', 'table'],
        tables: ['accuracy_summary'],
        figures: [],
        metricKeys: ['accuracy'],
        summaryRequired: true,
        ok: false,
        missingTables: ['accuracy_summary'],
        missingFigures: [],
      },
      workspaceSnapshot: {
        path: '/tmp/researchops-runs/run_123',
        sourceServerId: 'srv_remote_1',
        runSpecArtifactId: 'art_spec',
        localSnapshot: {
          kind: 'workspace_patch',
          note: 'local edits staged for remote execution',
        },
      },
      envSnapshot: {
        backend: 'container',
        runtimeClass: 'container-fast',
        resources: {
          cpu: 4,
          gpu: 1,
          ramGb: 24,
          timeoutMin: 30,
        },
      },
      summary: 'Execution complete.',
      highlights: {
        deliverableArtifactIds: ['art_summary', 'art_final'],
      },
      artifacts: [
        { id: 'art_summary', kind: 'run_summary_md' },
        { id: 'art_final', kind: 'agent_final_json' },
      ],
      checkpoints: [
        { id: 'cp_1', status: 'PENDING' },
        { id: 'cp_2', status: 'DECIDED' },
      ],
    },
  });

  assert.equal(payload.bridgeVersion, 'v0');
  assert.equal(payload.runId, 'run_123');
  assert.equal(payload.status, 'SUCCEEDED');
  assert.equal(payload.attempt.treeNodeId, 'node_eval');
  assert.equal(payload.execution.location, 'remote');
  assert.equal(payload.contract.summaryRequired, true);
  assert.equal(payload.contract.ok, false);
  assert.equal(payload.snapshots.workspace.path, '/tmp/researchops-runs/run_123');
  assert.equal(payload.snapshots.workspace.localSnapshot.kind, 'workspace_patch');
  assert.equal(payload.highlights.deliverableArtifactIds.length, 2);
  assert.equal(payload.counts.artifacts, 2);
  assert.equal(payload.counts.deliverables, 2);
  assert.equal(payload.counts.pendingCheckpoints, 1);
  assert.equal(payload.flags.hasSummary, true);
  assert.equal(payload.flags.hasFinalOutput, false);
  assert.equal(payload.flags.hasContractFailures, true);
  assert.equal(payload.followUp.relatedRunIds.length, 2);
  assert.equal(payload.bridgeRuntime.executionTarget, 'client-daemon');
  assert.equal(payload.bridgeRuntime.serverId, 'srv_client_1');
  assert.deepEqual(payload.bridgeRuntime.availableTransports, ['http', 'daemon-task', 'rust-daemon']);
  assert.equal(payload.bridgeRuntime.preferredTransport, 'daemon-task');
  assert.deepEqual(payload.taskActions.fetchNodeContext, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchNodeContext',
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
      runId: 'run_123',
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
  assert.deepEqual(payload.actions.contextPack, {
    method: 'GET',
    path: '/researchops/runs/run_123/context-pack',
  });
  assert.deepEqual(payload.actions.report, {
    method: 'GET',
    path: '/researchops/runs/run_123/report',
  });
  assert.deepEqual(payload.actions.artifacts, {
    method: 'GET',
    path: '/researchops/runs/run_123/artifacts',
  });
  assert.deepEqual(payload.actions.bridgeNote, {
    method: 'POST',
    path: '/researchops/runs/run_123/bridge-note',
  });
  assert.deepEqual(payload.submitHints.bridgeReport, {
    query: {
      transport: '"http"|"daemon-task"|"rust-daemon"',
    },
  });
  assert.deepEqual(payload.taskSubmitHints.captureWorkspaceSnapshot, {
    payload: {
      workspacePath: 'string',
      sourceServerId: 'string|null',
      kind: 'string',
      note: 'string|null',
    },
  });
  } finally {
    if (previousRustUrl === undefined) delete process.env.RESEARCHOPS_RUST_DAEMON_URL;
    else process.env.RESEARCHOPS_RUST_DAEMON_URL = previousRustUrl;
  }
});
