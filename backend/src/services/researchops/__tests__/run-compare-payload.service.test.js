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
