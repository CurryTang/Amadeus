'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunComparePayload } = require('../run-compare-payload.service');

test('buildRunComparePayload exposes comparable run/report summaries', () => {
  const baseRun = {
    id: 'run_base',
    projectId: 'proj_1',
    serverId: 'local-default',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    resolvedTransport: 'daemon-task',
    outputContract: {
      requiredArtifacts: ['summary'],
      summaryRequired: true,
      ok: false,
    },
    observability: {
      statuses: {
        readiness: 'needs_attention',
        contract: 'failing',
      },
      counts: {
        warnings: 1,
        sinks: 1,
      },
      sinkProviders: ['wandb'],
      warnings: ['contract validation failed'],
    },
    metadata: {
      treeNodeId: 'node_eval',
      treeNodeTitle: 'Evaluate model',
      parentRunId: 'run_seed',
      continuationPhase: 'analysis',
    },
  };
  const otherRun = {
    id: 'run_other',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'FAILED',
    metadata: {
      treeNodeId: 'node_eval',
      treeNodeTitle: 'Evaluate model',
      parentRunId: 'run_seed',
      branchLabel: 'ablation-b',
    },
  };

  const payload = buildRunComparePayload({
    run: baseRun,
    otherRun,
    report: {
      summary: 'baseline summary',
      highlights: {
        summaryArtifactId: 'artifact_summary_1',
        finalOutputArtifactId: 'artifact_final_1',
        deliverableArtifactIds: ['artifact_summary_1', 'artifact_final_1'],
      },
      workspaceSnapshot: { path: '/tmp/researchops-runs/run_base' },
      envSnapshot: { backend: 'local' },
      checkpoints: [{ id: 'cp_1', status: 'passed' }],
    },
    otherReport: {
      summary: 'ablation summary',
      highlights: {
        summaryArtifactId: 'artifact_summary_2',
        finalOutputArtifactId: null,
        deliverableArtifactIds: ['artifact_summary_2'],
      },
      observability: {
        statuses: {
          readiness: 'needs_attention',
        },
        counts: {
          warnings: 2,
        },
      },
      workspaceSnapshot: { path: '/tmp/researchops-runs/run_other' },
      envSnapshot: { backend: 'container' },
      checkpoints: [{ id: 'cp_2', status: 'failed' }],
    },
    requestedOtherRunId: 'run_other',
  });

  assert.equal(payload.run.id, 'run_base');
  assert.equal(payload.other.run.id, 'run_other');
  assert.equal(payload.other.execution.location, 'remote');
  assert.equal(payload.relation.requestedOtherRunId, 'run_other');
  assert.equal(payload.relation.sameProject, true);
  assert.equal(payload.relation.sameNode, true);
  assert.equal(payload.relation.sharedTreeNodeId, 'node_eval');
  assert.deepEqual(payload.relation.sharedParentRunIds, ['run_seed']);
  assert.deepEqual(payload.contract, {
    requiredArtifacts: ['summary'],
    tables: [],
    figures: [],
    metricKeys: [],
    summaryRequired: true,
    ok: null,
    missingTables: [],
    missingFigures: [],
  });
  assert.deepEqual(payload.workspaceSnapshot, {
    path: null,
    sourceServerId: 'local-default',
    runSpecArtifactId: null,
    localSnapshot: null,
  });
  assert.deepEqual(payload.envSnapshot, {
    backend: 'local',
    runtimeClass: null,
    resources: {
      cpu: null,
      gpu: null,
      ramGb: null,
      timeoutMin: null,
    },
  });
  assert.deepEqual(payload.observability, {
    counts: {
      warnings: 1,
      sinks: 1,
    },
    statuses: {
      readiness: 'needs_attention',
      contract: 'failing',
    },
    sinkProviders: ['wandb'],
    warnings: ['contract validation failed'],
  });
  assert.equal(payload.resolvedTransport, 'daemon-task');
  assert.deepEqual(payload.report.highlights.deliverableArtifactIds, ['artifact_summary_1', 'artifact_final_1']);
  assert.equal(payload.other.report.summary, 'ablation summary');
  assert.equal(payload.other.report.observability.statuses.readiness, 'needs_attention');
  assert.deepEqual(payload.other.report.checkpointStatuses, ['failed']);
  assert.deepEqual(payload.actions.report, {
    method: 'GET',
    path: '/researchops/runs/run_base/report',
  });
  assert.deepEqual(payload.actions.compare, {
    method: 'GET',
    path: '/researchops/runs/run_base/compare?otherRunId=run_other',
  });
  assert.deepEqual(payload.other.actions.artifacts, {
    method: 'GET',
    path: '/researchops/runs/run_other/artifacts',
  });
  assert.deepEqual(payload.other.actions.bridgeReport, {
    method: 'GET',
    path: '/researchops/runs/run_other/bridge-report',
  });
});
