'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunPayload } = require('../run-payload.service');

test('buildRunPayload keeps the run while exposing attempt semantics', () => {
  const run = {
    id: 'run_123',
    projectId: 'proj_1',
    serverId: 'local-default',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'SUCCEEDED',
    metadata: {
      treeNodeId: 'baseline_root',
      treeNodeTitle: 'Baseline Root',
      runSource: 'run-step',
    },
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.run, run);
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.attempt.status, 'SUCCEEDED');
  assert.equal(payload.execution.serverId, 'local-default');
  assert.equal(payload.execution.location, 'local');
  assert.equal(payload.execution.backend, 'local');
  assert.equal('bundle' in payload, false);
});

test('buildRunPayload exposes explicit execution contract fields when metadata carries job spec details', () => {
  const run = {
    id: 'run_exec',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    mode: 'headless',
    status: 'QUEUED',
    metadata: {
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
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.execution.serverId, 'srv_remote_1');
  assert.equal(payload.execution.location, 'remote');
  assert.equal(payload.execution.mode, 'headless');
  assert.equal(payload.execution.backend, 'container');
  assert.equal(payload.execution.runtimeClass, 'container-fast');
  assert.deepEqual(payload.execution.runtimeProfile, {
    catalogVersion: 'v0',
    backend: 'container',
    runtimeClass: 'container-fast',
    backendKnown: true,
    runtimeClassKnown: true,
    backendLabel: 'Container',
    runtimeClassLabel: 'Container Fast',
    runtimeFamily: 'container',
    isolationTier: 'standard',
    executionTarget: 'managed-runner',
    compatibilityStatus: 'compatible',
    compatibilityWarning: '',
  });
  assert.deepEqual(payload.execution.resources, {
    cpu: 4,
    gpu: 1,
    ramGb: 24,
    timeoutMin: 30,
  });
});

test('buildRunPayload exposes follow-up semantics for continuation and compare-linked runs', () => {
  const run = {
    id: 'run_followup',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    contextRefs: {
      continueRunIds: ['run_base', 'run_alt'],
    },
    metadata: {
      parentRunId: 'run_base',
      continuationOfRunId: 'run_base',
      continuationPhase: 'analysis',
      branchLabel: 'ablation-b',
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.followUp, {
    parentRunId: 'run_base',
    continuationOfRunId: 'run_base',
    continuationPhase: 'analysis',
    branchLabel: 'ablation-b',
    relatedRunIds: ['run_base', 'run_alt'],
    isContinuation: true,
  });
});

test('buildRunPayload exposes normalized output contract semantics', () => {
  const run = {
    id: 'run_contract',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'QUEUED',
    outputContract: {
      requiredArtifacts: ['metrics', 'table', 'figure'],
      tables: ['accuracy_summary'],
      figures: ['loss_curve'],
      metricKeys: ['accuracy', 'loss'],
      summaryRequired: true,
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.contract, {
    requiredArtifacts: ['metrics', 'table', 'figure'],
    tables: ['accuracy_summary'],
    figures: ['loss_curve'],
    metricKeys: ['accuracy', 'loss'],
    summaryRequired: true,
    ok: null,
    missingTables: [],
    missingFigures: [],
  });
});

test('buildRunPayload exposes normalized workspace and env snapshot semantics', () => {
  const run = {
    id: 'run_snapshot',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    metadata: {
      cwdSourceServerId: 'srv_sync_1',
      workspaceSnapshot: {
        path: '/tmp/research-workspace',
        sourceServerId: 'srv_snap_1',
        runSpecArtifactId: 'artifact_run_spec',
      },
      localSnapshot: {
        kind: 'git_diff',
        note: 'dirty working tree',
      },
      jobSpec: {
        backend: 'container',
        runtimeClass: 'container-fast',
        resources: {
          cpu: 8,
          ramGb: 32,
        },
      },
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.workspaceSnapshot, {
    path: '/tmp/research-workspace',
    sourceServerId: 'srv_snap_1',
    runSpecArtifactId: 'artifact_run_spec',
    localSnapshot: {
      kind: 'git_diff',
      note: 'dirty working tree',
    },
  });
  assert.deepEqual(payload.envSnapshot, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 8,
      gpu: null,
      ramGb: 32,
      timeoutMin: null,
    },
  });
});

test('buildRunPayload exposes thin normalized observability when run already carries summary data', () => {
  const run = {
    id: 'run_obs',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    observability: {
      counts: {
        warnings: 2,
        sinks: 1,
      },
      statuses: {
        readiness: 'needs_attention',
        contract: 'failing',
      },
      sinkProviders: ['wandb'],
      warnings: ['contract validation failed', 'wandb timeout'],
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.observability, {
    counts: {
      warnings: 2,
      sinks: 1,
    },
    statuses: {
      readiness: 'needs_attention',
      contract: 'failing',
    },
    sinkProviders: ['wandb'],
    warnings: ['contract validation failed', 'wandb timeout'],
  });
});

test('buildRunPayload preserves resolved bridge transport when present on the run', () => {
  const run = {
    id: 'run_transport',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    resolvedTransport: 'daemon-task',
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.resolvedTransport, 'daemon-task');
});

test('buildRunPayload exposes thin output flags when run carries highlights', () => {
  const run = {
    id: 'run_output',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    summary: 'Completed summary',
    highlights: {
      summaryArtifactId: 'art_summary',
      finalOutputArtifactId: 'art_final',
      deliverableArtifactIds: ['art_summary', 'art_final'],
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.output, {
    hasSummary: true,
    hasFinalOutput: true,
    deliverableArtifactIds: ['art_summary', 'art_final'],
    summaryArtifactId: 'art_summary',
    finalOutputArtifactId: 'art_final',
  });
});
