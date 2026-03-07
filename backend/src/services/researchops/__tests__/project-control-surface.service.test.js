'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectControlSurface } = require('../project-control-surface.service');

test('buildProjectControlSurface aggregates review, runtime, execution, and observability signals', () => {
  const surface = buildProjectControlSurface({
    runs: [
      {
        id: 'run_1',
        status: 'FAILED',
        serverId: 'srv_remote_1',
        execution: {
          location: 'remote',
          backend: 'container',
          runtimeClass: 'container-fast',
        },
        contract: {
          ok: false,
        },
        output: {
          hasSummary: true,
          hasFinalOutput: false,
        },
        workspaceSnapshot: {
          localSnapshot: {
            kind: 'workspace_patch',
          },
        },
        observability: {
          counts: {
            warnings: 2,
          },
          sinkProviders: ['wandb'],
        },
        resolvedTransport: 'rust-daemon',
      },
      {
        id: 'run_2',
        status: 'RUNNING',
        execution: {
          location: 'local',
          backend: 'local',
          runtimeClass: 'wasm-lite',
        },
        output: {
          hasSummary: false,
          hasFinalOutput: false,
        },
        observability: {
          counts: {
            warnings: 0,
          },
          sinkProviders: ['tensorboard'],
        },
        resolvedTransport: 'http',
      },
    ],
    runtimeSummary: {
      onlineClients: 2,
      bridgeReadyClients: 1,
      snapshotReadyClients: 1,
      rustManagedRunning: false,
      rustManagedDesired: true,
      rustHealthState: 'degraded',
      rustLastFailureReason: 'docker unavailable',
      recommendedBackend: 'container',
      recommendedRuntimeClass: 'container-guarded',
      recommendationReason: 'Managed Rust bridge runtime is online for guarded execution.',
    },
  });

  assert.deepEqual(surface.review, {
    attentionRuns: 1,
    contractFailures: 1,
    missingOutputs: 2,
    warnings: 2,
    status: 'needs_attention',
  });
  assert.deepEqual(surface.runtime, {
    onlineClients: 2,
    bridgeReadyClients: 1,
    snapshotReadyClients: 1,
    rustManagedRunning: false,
    rustManagedDesired: true,
    rustHealthState: 'degraded',
    rustLastFailureReason: 'docker unavailable',
    runtimeDrift: true,
  });
  assert.deepEqual(surface.execution, {
    remoteRuns: 1,
    snapshotBackedRuns: 1,
    transportMix: ['http', 'rust-daemon'],
    runtimeMix: ['container/container-fast', 'local/wasm-lite'],
  });
  assert.deepEqual(surface.observability, {
    instrumentedRuns: 2,
    sinkProviders: ['tensorboard', 'wandb'],
  });
  assert.deepEqual(surface.recommendation, {
    backend: 'container',
    runtimeClass: 'container-guarded',
    reason: 'Managed Rust bridge runtime is online for guarded execution.',
    nextAction: 'fix-runtime',
  });
});
