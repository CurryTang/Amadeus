'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeRunReportPayload } = require('../bridge-run-report-payload.service');

test('buildBridgeRunReportPayload exposes bridge-friendly current run summary fields', () => {
  const payload = buildBridgeRunReportPayload({
    report: {
      run: {
        id: 'run_123',
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
  assert.equal(payload.snapshots.workspace.path, '/tmp/researchops-runs/run_123');
  assert.equal(payload.snapshots.workspace.localSnapshot.kind, 'workspace_patch');
  assert.equal(payload.highlights.deliverableArtifactIds.length, 2);
  assert.equal(payload.counts.artifacts, 2);
  assert.equal(payload.counts.pendingCheckpoints, 1);
  assert.equal(payload.followUp.relatedRunIds.length, 2);
});
