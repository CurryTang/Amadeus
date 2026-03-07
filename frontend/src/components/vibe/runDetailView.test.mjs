import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunCompareOptions,
  buildRunDetailContext,
  buildRunCompareSummary,
  buildRunContractSummary,
  buildRunExecutionSummary,
  buildRunFollowUpSummary,
  buildRunBridgeSummary,
  buildRunObservabilitySummary,
  buildRunSnapshotSummary,
  deriveRunCompareTargetId,
  buildRunDetailPrompt,
  buildRunDetailOutput,
} from './runDetailView.js';

const BASE_RUN = {
  id: 'run_123',
  serverId: 'chatdse',
  status: 'SUCCEEDED',
  metadata: {
    sourceType: 'tree',
    treeNodeTitle: 'Patch branch',
    todoTitle: 'Clean benchmark harness',
    parentRunId: 'run_parent',
    runWorkspacePath: '/tmp/researchops-runs/run_123',
    prompt: 'Patch the benchmark harness and summarize changes.',
  },
};

test('buildRunDetailContext exposes provenance and workspace info', () => {
  const context = buildRunDetailContext(BASE_RUN, {
    runWorkspacePath: '/tmp/researchops-runs/run_123',
  });

  assert.equal(context.sourceLabel, 'Tree');
  assert.equal(context.treeNodeTitle, 'Patch branch');
  assert.equal(context.todoTitle, 'Clean benchmark harness');
  assert.equal(context.parentRunId, 'run_parent');
  assert.equal(context.serverId, 'chatdse');
  assert.equal(context.workspacePath, '/tmp/researchops-runs/run_123');
});

test('buildRunDetailPrompt prefers prompt text and labels it as user prompt', () => {
  const prompt = buildRunDetailPrompt(BASE_RUN);

  assert.equal(prompt.label, 'User Prompt');
  assert.equal(prompt.text, 'Patch the benchmark harness and summarize changes.');
});

test('buildRunDetailOutput surfaces summary, final output artifact, and figures', () => {
  const output = buildRunDetailOutput(BASE_RUN, {
    summary: 'Implementation completed successfully.',
    artifacts: [
      { id: 'art_final', kind: 'agent_final_json', title: 'Final Output', objectUrl: '/final.json' },
      { id: 'art_summary', kind: 'run_summary_md', title: 'Summary', objectUrl: '/summary.md' },
      { id: 'art_plot', kind: 'plot', title: 'Loss Curve', objectUrl: '/plot.png', mimeType: 'image/png' },
    ],
    manifest: {
      figures: [{ id: 'art_plot', title: 'Loss Curve', objectUrl: '/plot.png' }],
      tables: [],
    },
    highlights: {
      deliverableArtifactIds: ['art_summary', 'art_final'],
      finalOutputArtifactId: 'art_final',
    },
  });

  assert.equal(output.summary, 'Implementation completed successfully.');
  assert.equal(output.finalOutputArtifact?.id, 'art_final');
  assert.equal(output.deliverables.length, 1);
  assert.deepEqual(output.deliverableArtifacts.map((item) => item.id), ['art_summary', 'art_final']);
});

test('buildRunDetailContext falls back to attempt metadata when run metadata is sparse', () => {
  const context = buildRunDetailContext({
    id: 'run_sparse',
    serverId: 'chatdse',
    status: 'RUNNING',
    metadata: {
      sourceType: 'tree',
      runWorkspacePath: '',
    },
  }, {
    workspace: {
      path: '/tmp/researchops-runs/run_sparse',
    },
    attempt: {
      treeNodeTitle: 'Recovered Tree Title',
    },
  });

  assert.equal(context.treeNodeTitle, 'Recovered Tree Title');
  assert.equal(context.workspacePath, '/tmp/researchops-runs/run_sparse');
});

test('buildRunExecutionSummary prefers normalized execution view and formats resources', () => {
  const execution = buildRunExecutionSummary({
    ...BASE_RUN,
    mode: 'headless',
    execution: {
      serverId: 'srv_remote_1',
      location: 'remote',
      mode: 'headless',
      backend: 'container',
      runtimeClass: 'container-fast',
      resources: {
        cpu: 4,
        gpu: 1,
        ramGb: 24,
        timeoutMin: 30,
      },
    },
  });

  assert.deepEqual(execution, {
    serverId: 'srv_remote_1',
    location: 'remote',
    mode: 'headless',
    backend: 'container',
    runtimeClass: 'container-fast',
    resourcesLabel: 'cpu 4 · gpu 1 · ram 24GB · timeout 30m',
  });
});

test('buildRunSnapshotSummary exposes workspace and environment snapshot rows when present', () => {
  const summary = buildRunSnapshotSummary({
    execution: {
      backend: 'container',
      runtimeClass: 'container-fast',
    },
  }, {
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
  });

  assert.deepEqual(summary, [
    { label: 'Workspace Path', value: '/tmp/researchops-runs/run_123' },
    { label: 'Workspace Source', value: 'srv_remote_1' },
    { label: 'Run Spec', value: 'art_spec' },
    { label: 'Local Snapshot', value: 'workspace_patch' },
    { label: 'Local Note', value: 'local edits staged for remote execution' },
    { label: 'Env Backend', value: 'container' },
    { label: 'Runtime Class', value: 'container-fast' },
    { label: 'Env Resources', value: 'cpu 4 · gpu 1 · ram 24GB · timeout 30m' },
  ]);
});

test('buildRunBridgeSummary exposes bridge runtime, transport, and daemon task status', () => {
  const summary = buildRunBridgeSummary(BASE_RUN, {
    bridgeRuntime: {
      executionTarget: 'client-daemon',
      serverId: 'srv_client_1',
      supportsLocalBridgeWorkflow: false,
      missingBridgeTaskTypes: ['bridge.submitRunNote'],
      availableTransports: ['http', 'rust-daemon'],
      preferredTransport: 'rust-daemon',
    },
    taskActions: {
      fetchRunReport: {
        transport: 'daemon-task',
        serverId: 'srv_client_1',
        taskType: 'bridge.fetchRunReport',
      },
      submitRunNote: {
        transport: 'daemon-task',
        serverId: 'srv_client_1',
        taskType: 'bridge.submitRunNote',
      },
      captureWorkspaceSnapshot: {
        transport: 'daemon-task',
        serverId: 'srv_client_1',
        taskType: 'bridge.captureWorkspaceSnapshot',
      },
    },
  });

  assert.deepEqual(summary, [
    { label: 'Bridge Runtime', value: 'client-daemon' },
    { label: 'Bridge Server', value: 'srv_client_1' },
    { label: 'Preferred Transport', value: 'rust-daemon' },
    { label: 'Available Transports', value: 'http, rust-daemon' },
    { label: 'Bridge Transport', value: 'daemon-task available' },
    { label: 'Missing Bridge Tasks', value: 'bridge.submitRunNote' },
    { label: 'Bridge Report Task', value: 'bridge.fetchRunReport' },
    { label: 'Bridge Note Task', value: 'bridge.submitRunNote' },
    { label: 'Snapshot Capture', value: 'bridge.captureWorkspaceSnapshot' },
  ]);
});

test('buildRunObservabilitySummary exposes step, artifact, checkpoint, and output readiness counts', () => {
  const summary = buildRunObservabilitySummary(BASE_RUN, {
    steps: [{ id: 'step_1' }, { id: 'step_2' }, { id: 'step_3' }],
    artifacts: [{ id: 'art_1' }, { id: 'art_2' }, { id: 'art_3' }, { id: 'art_4' }],
    checkpoints: [
      { id: 'chk_1', status: 'PENDING' },
      { id: 'chk_2', status: 'APPROVED' },
    ],
    summary: 'Execution completed successfully.',
    highlights: {
      finalOutputArtifactId: 'art_4',
      deliverableArtifactIds: ['art_2', 'art_4'],
    },
  });

  assert.deepEqual(summary, [
    { label: 'Steps', value: '3 recorded' },
    { label: 'Artifacts', value: '4 captured' },
    { label: 'Checkpoints', value: '1 pending · 1 resolved' },
    { label: 'Summary', value: 'Present' },
    { label: 'Final Output', value: 'Present' },
    { label: 'Deliverables', value: '2 captured' },
  ]);
});

test('buildRunObservabilitySummary prefers normalized observability rows when available', () => {
  const summary = buildRunObservabilitySummary(BASE_RUN, {
    observability: {
      counts: {
        steps: 3,
        artifacts: 4,
        deliverables: 2,
        checkpoints: 2,
        pendingCheckpoints: 1,
        resolvedCheckpoints: 1,
        sinks: 2,
        warnings: 3,
      },
      statuses: {
        readiness: 'needs_attention',
        contract: 'failing',
      },
      sinkProviders: ['tensorboard', 'wandb'],
      warnings: [
        'Contract validation failed',
        '1 checkpoints pending review',
        'wandb adapter failed: timeout',
      ],
    },
  });

  assert.deepEqual(summary, [
    { label: 'Readiness', value: 'Needs attention' },
    { label: 'Steps', value: '3 recorded' },
    { label: 'Artifacts', value: '4 captured' },
    { label: 'Checkpoints', value: '1 pending · 1 resolved' },
    { label: 'Sinks', value: 'tensorboard, wandb' },
    { label: 'Contract', value: 'Validation failed' },
    { label: 'Deliverables', value: '2 captured' },
    { label: 'Warnings', value: 'Contract validation failed · 1 checkpoints pending review +1 more' },
  ]);
});

test('buildRunFollowUpSummary exposes continuation and related-run rows', () => {
  const summary = buildRunFollowUpSummary({
    metadata: {
      parentRunId: 'run_base',
    },
    followUp: {
      parentRunId: 'run_base',
      continuationOfRunId: 'run_base',
      continuationPhase: 'analysis',
      branchLabel: 'ablation-b',
      relatedRunIds: ['run_base', 'run_alt'],
      isContinuation: true,
    },
  });

  assert.deepEqual(summary, [
    { label: 'Parent Run', value: 'run_base' },
    { label: 'Follow-up', value: 'Continuation' },
    { label: 'Phase', value: 'analysis' },
    { label: 'Branch', value: 'ablation-b' },
    { label: 'Related Runs', value: 'run_base, run_alt' },
  ]);
});

test('deriveRunCompareTargetId prefers related runs and falls back to parent run ids', () => {
  assert.equal(deriveRunCompareTargetId({
    id: 'run_current',
    followUp: {
      relatedRunIds: ['run_current', 'run_alt', 'run_parent'],
      parentRunId: 'run_parent',
    },
  }), 'run_alt');

  assert.equal(deriveRunCompareTargetId({
    id: 'run_current',
    metadata: {
      parentRunId: 'run_parent',
    },
  }), 'run_parent');

  assert.equal(deriveRunCompareTargetId({ id: 'run_current' }, { followUp: { relatedRunIds: [] } }), '');
});

test('buildRunCompareSummary surfaces other-run status, relation info, and summary text', () => {
  const summary = buildRunCompareSummary({
    other: {
      run: {
        id: 'run_other',
        status: 'FAILED',
      },
      attempt: {
        treeNodeTitle: 'Evaluation branch',
      },
      report: {
        summary: 'Ablation branch regressed on accuracy.',
        observability: {
          statuses: {
            readiness: 'needs_attention',
          },
          counts: {
            warnings: 2,
          },
        },
        workspaceSnapshot: {
          localSnapshot: {
            kind: 'workspace_patch',
          },
        },
        highlights: {
          deliverableArtifactIds: ['art_summary'],
        },
      },
      execution: {
        location: 'remote',
      },
    },
    relation: {
      sameNode: true,
      sharedParentRunIds: ['run_seed'],
      relatedRunIds: ['run_seed', 'run_other'],
    },
  });

  assert.deepEqual(summary, {
    otherRunId: 'run_other',
    otherStatus: 'FAILED',
    otherNodeTitle: 'Evaluation branch',
    otherSummary: 'Ablation branch regressed on accuracy.',
    otherReadiness: 'Needs attention',
    otherWarnings: '2 warnings',
    otherExecutionLocation: 'remote',
    otherSnapshotBacked: true,
    sharedParentRunsLabel: 'run_seed',
    relatedRunsLabel: 'run_seed, run_other',
    deliverableCount: 1,
    sameNode: true,
  });
});

test('buildRunCompareOptions lists related runs with visible titles and stable ids', () => {
  const options = buildRunCompareOptions(
    {
      id: 'run_current',
      metadata: {
        parentRunId: 'run_parent',
      },
      followUp: {
        relatedRunIds: ['run_alt', 'run_parent'],
      },
    },
    {},
    [
      {
        id: 'run_alt',
        metadata: {
          prompt: 'Compare ablation branch',
        },
      },
      {
        id: 'run_parent',
        metadata: {
          experimentCommand: 'python eval.py',
        },
      },
    ]
  );

  assert.deepEqual(options, [
    { value: 'run_alt', label: 'Compare ablation branch' },
    { value: 'run_parent', label: 'python eval.py' },
  ]);
});

test('buildRunContractSummary exposes required artifacts and missing validations', () => {
  const rows = buildRunContractSummary({
    outputContract: {
      requiredArtifacts: ['metrics', 'table'],
    },
  }, {
    contract: {
      requiredArtifacts: ['metrics', 'table'],
      tables: ['accuracy_summary'],
      figures: ['loss_curve'],
      metricKeys: ['accuracy'],
      summaryRequired: true,
      ok: false,
      missingTables: ['accuracy_summary'],
      missingFigures: [],
    },
  });

  assert.deepEqual(rows, [
    { label: 'Required Artifacts', value: 'metrics, table' },
    { label: 'Tables', value: 'accuracy_summary' },
    { label: 'Figures', value: 'loss_curve' },
    { label: 'Metric Keys', value: 'accuracy' },
    { label: 'Summary', value: 'Required' },
    { label: 'Contract Check', value: 'Validation failed' },
    { label: 'Missing Tables', value: 'accuracy_summary' },
  ]);
});
