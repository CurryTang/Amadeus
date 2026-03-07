'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunReportPayload } = require('../run-report-payload.service');

test('buildRunReportPayload exposes attempt semantics while staying run-centered', () => {
  const payload = buildRunReportPayload({
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
  assert.equal('bundle' in payload, false);
  assert.equal('reviewQueue' in payload, false);
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
