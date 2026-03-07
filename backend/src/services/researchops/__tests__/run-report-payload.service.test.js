'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunReportPayload } = require('../run-report-payload.service');

test('buildRunReportPayload exposes attempt semantics while staying run-centered', () => {
  const payload = buildRunReportPayload({
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
    run: {
      id: 'run_123',
      projectId: 'proj_1',
      serverId: 'srv_remote_1',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      mode: 'headless',
      metadata: {
        treeNodeId: 'baseline_root',
        treeNodeTitle: 'Baseline Root',
        runSource: 'run-step',
        parentRunId: 'run_parent',
        continuationPhase: 'analysis',
        runWorkspacePath: '/tmp/researchops-runs/run_123',
        cwdSourceServerId: 'srv_remote_1',
        localSnapshot: {
          kind: 'workspace_patch',
          note: 'local edits staged for remote execution',
        },
        jobSpec: {
          backend: 'container',
          runtimeClass: 'container-fast',
          resources: {
            cpu: 4,
            gpu: 1,
            ramGb: 24,
            timeoutMin: 30,
          },
        },
      },
      contextRefs: {
        continueRunIds: ['run_parent'],
      },
    },
    steps: [],
    artifacts: [
      { id: 'art_summary', kind: 'run_summary_md' },
      { id: 'art_final', kind: 'agent_final_json' },
      { id: 'art_report', kind: 'deliverable_report' },
      { id: 'art_spec', kind: 'run_spec_snapshot' },
    ],
    checkpoints: [],
    summaryText: 'Execution complete.',
    manifest: null,
  });

  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.nodeId, 'baseline_root');
  assert.equal(payload.attempt.treeNodeTitle, 'Baseline Root');
  assert.equal(payload.execution.backend, 'container');
  assert.equal(payload.execution.runtimeClass, 'container-fast');
  assert.deepEqual(payload.highlights.deliverableArtifactIds, ['art_summary', 'art_final', 'art_report']);
  assert.deepEqual(payload.workspaceSnapshot, {
    path: '/tmp/researchops-runs/run_123',
    sourceServerId: 'srv_remote_1',
    runSpecArtifactId: 'art_spec',
    localSnapshot: {
      kind: 'workspace_patch',
      note: 'local edits staged for remote execution',
    },
  });
  assert.deepEqual(payload.followUp, {
    parentRunId: 'run_parent',
    continuationOfRunId: null,
    continuationPhase: 'analysis',
    branchLabel: null,
    relatedRunIds: ['run_parent'],
    isContinuation: true,
  });
  assert.deepEqual(payload.envSnapshot, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 4,
      gpu: 1,
      ramGb: 24,
      timeoutMin: 30,
    },
  });
  assert.deepEqual(payload.contract, {
    requiredArtifacts: [],
    tables: [],
    figures: [],
    metricKeys: [],
    summaryRequired: false,
    ok: null,
    missingTables: [],
    missingFigures: [],
  });
  assert.equal(payload.bridgeRuntime.executionTarget, 'client-daemon');
  assert.equal(payload.bridgeRuntime.serverId, 'srv_client_1');
  assert.deepEqual(payload.taskActions.fetchNodeContext, {
    transport: 'daemon-task',
    serverId: 'srv_client_1',
    taskType: 'bridge.fetchNodeContext',
    payload: {
      projectId: 'proj_1',
      nodeId: 'baseline_root',
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
  assert.equal('bundle' in payload, false);
  assert.equal('reviewQueue' in payload, false);
});

test('buildRunReportPayload exposes output contract validation when run contract and manifest validation exist', () => {
  const payload = buildRunReportPayload({
    run: {
      id: 'run_contract',
      projectId: 'proj_1',
      serverId: 'srv_remote_1',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      outputContract: {
        requiredArtifacts: ['metrics', 'table'],
        tables: ['accuracy_summary'],
        figures: ['loss_curve'],
        metricKeys: ['accuracy'],
        summaryRequired: true,
      },
      metadata: {
        jobSpec: {
          backend: 'container',
          runtimeClass: 'container-fast',
        },
      },
    },
    steps: [],
    artifacts: [],
    checkpoints: [],
    summaryText: null,
    manifest: {
      contractValidation: {
        ok: false,
        missingTables: ['accuracy_summary'],
        missingFigures: [],
      },
    },
  });

  assert.deepEqual(payload.contract, {
    requiredArtifacts: ['metrics', 'table'],
    tables: ['accuracy_summary'],
    figures: ['loss_curve'],
    metricKeys: ['accuracy'],
    summaryRequired: true,
    ok: false,
    missingTables: ['accuracy_summary'],
    missingFigures: [],
  });
});

test('buildRunReportPayload derives a remote workspace path when metadata is missing it', () => {
  const payload = buildRunReportPayload({
    run: {
      id: 'run_remote',
      projectId: 'proj_1',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      metadata: {
        treeNodeId: 'baseline_root',
      },
    },
    steps: [
      {
        stepId: 'step_1',
        metrics: {
          execServerId: 'chatdse',
        },
      },
    ],
    artifacts: [],
    checkpoints: [],
    summaryText: null,
    manifest: null,
  });

  assert.equal(payload.runWorkspacePath, '/tmp/researchops-runs/run_remote');
  assert.deepEqual(payload.workspace, {
    path: '/tmp/researchops-runs/run_remote',
  });
});

test('buildRunReportPayload exposes a normalized observability view', () => {
  const payload = buildRunReportPayload({
    run: {
      id: 'run_obsv',
      projectId: 'proj_1',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      outputContract: {
        summaryRequired: true,
      },
    },
    steps: [{ id: 'step_1' }],
    artifacts: [
      { id: 'art_summary', kind: 'run_summary_md' },
      { id: 'art_final', kind: 'agent_final_json' },
    ],
    checkpoints: [{ id: 'cp_1', status: 'PENDING' }],
    summaryText: 'Done.',
    manifest: {
      summary: {
        tableCount: 1,
        figureCount: 0,
        metricArtifactCount: 2,
      },
      observability: {
        sinks: {
          wandb: { url: 'https://wandb.example/run_obsv' },
        },
        warnings: ['wandb adapter failed: retry budget exhausted'],
      },
      contractValidation: {
        ok: false,
        missingTables: ['metrics'],
        missingFigures: [],
      },
    },
  });

  assert.equal(payload.observability.counts.steps, 1);
  assert.equal(payload.observability.counts.deliverables, 2);
  assert.equal(payload.observability.counts.warnings, 3);
  assert.equal(payload.observability.statuses.readiness, 'needs_attention');
  assert.deepEqual(payload.observability.sinkProviders, ['wandb']);
  assert.deepEqual(payload.observability.warnings, [
    '1 checkpoints pending review',
    'Contract validation failed',
    'wandb adapter failed: retry budget exhausted',
  ]);
});
