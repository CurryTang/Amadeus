import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildProjectControlSurfaceRows,
  formatControlSurfaceNextActionLabel as formatProjectActionLabel,
} from './daemonPresentation.js';
import {
  buildNodeControlSurfaceRows,
  formatControlSurfaceNextActionLabel as formatNodeActionLabel,
} from './reviewPresentation.js';

test('buildProjectControlSurfaceRows renders project control-surface rows with next action labels', () => {
  const rows = buildProjectControlSurfaceRows({
    projectControlSurface: {
      review: {
        status: 'needs_attention',
        attentionRuns: 2,
        contractFailures: 1,
        missingOutputs: 3,
        warnings: 4,
      },
      runtime: {
        onlineClients: 2,
        bridgeReadyClients: 1,
        snapshotReadyClients: 1,
        runtimeDrift: true,
        rustHealthState: 'degraded',
      },
      execution: {
        remoteRuns: 3,
        snapshotBackedRuns: 1,
        transportMix: ['daemon-task', 'rust-daemon'],
      },
      observability: {
        sinkProviders: ['tensorboard', 'wandb'],
      },
      recommendation: {
        backend: 'container',
        runtimeClass: 'container-guarded',
        nextAction: 'fix-runtime',
      },
    },
  });

  assert.deepEqual(rows, [
    { label: 'Control Status', value: 'needs attention' },
    { label: 'Attention Runs', value: '2' },
    { label: 'Contract Failures', value: '1' },
    { label: 'Missing Outputs', value: '3' },
    { label: 'Warnings', value: '4' },
    { label: 'Runtime Drift', value: 'managed desired, runtime down' },
    { label: 'Runtime Health', value: 'degraded' },
    { label: 'Recommended Runtime', value: 'container / container-guarded' },
    { label: 'Next Action', value: 'Fix runtime' },
    { label: 'Remote Runs', value: '3' },
    { label: 'Snapshot-Backed Runs', value: '1' },
    { label: 'Transports', value: 'daemon-task, rust-daemon' },
    { label: 'Telemetry', value: 'tensorboard, wandb' },
    { label: 'Client Coverage', value: '1/2 bridge-ready · 1/2 snapshot-ready' },
  ]);
});

test('buildNodeControlSurfaceRows renders node control-surface rows with recommended next action', () => {
  const rows = buildNodeControlSurfaceRows({
    runReport: {
      run: {
        status: 'FAILED',
      },
      contract: {
        ok: false,
      },
      execution: {
        location: 'remote',
        backend: 'container',
        runtimeClass: 'container-fast',
      },
      resolvedTransport: 'rust-daemon',
      workspaceSnapshot: {
        localSnapshot: {
          kind: 'workspace_patch',
        },
      },
      highlights: {
        deliverableArtifactIds: ['art_report'],
        summaryArtifactId: 'art_summary',
      },
      output: {
        hasSummary: true,
        hasFinalOutput: false,
      },
      observability: {
        statuses: {
          readiness: 'needs_attention',
        },
        counts: {
          warnings: 2,
        },
        sinkProviders: ['wandb'],
      },
    },
  });

  assert.deepEqual(rows, [
    { label: 'Run State', value: 'FAILED' },
    { label: 'Contract State', value: 'Validation failed' },
    { label: 'Output State', value: 'Partial' },
    { label: 'Deliverables', value: '1' },
    { label: 'Execution', value: 'remote' },
    { label: 'Runtime', value: 'container/container-fast' },
    { label: 'Transport', value: 'rust-daemon' },
    { label: 'Snapshot State', value: 'Snapshot-backed' },
    { label: 'Readiness', value: 'Needs attention' },
    { label: 'Warnings', value: '2 warnings' },
    { label: 'Sinks', value: 'wandb' },
    { label: 'Next Action', value: 'Review output' },
  ]);
});

test('control-surface action formatters map stable action ids to UI labels', () => {
  assert.equal(formatProjectActionLabel('sync-snapshot'), 'Sync snapshot');
  assert.equal(formatNodeActionLabel('rerun'), 'Rerun');
});
