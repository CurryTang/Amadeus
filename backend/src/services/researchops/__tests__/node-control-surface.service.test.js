'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildNodeControlSurface } = require('../node-control-surface.service');

test('buildNodeControlSurface aggregates node review, execution, and observability state', () => {
  const surface = buildNodeControlSurface({
    run: {
      id: 'run_1',
      status: 'FAILED',
      resolvedTransport: 'rust-daemon',
    },
    report: {
      contract: {
        ok: false,
      },
      highlights: {
        deliverableArtifactIds: ['art_report'],
        summaryArtifactId: 'art_summary',
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
      execution: {
        location: 'remote',
        backend: 'container',
        runtimeClass: 'container-fast',
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
    runtimeSummary: {
      rustHealthState: 'healthy',
    },
  });

  assert.deepEqual(surface.review, {
    latestRunState: 'FAILED',
    contractState: 'failing',
    outputState: 'partial',
    deliverableCount: 1,
  });
  assert.deepEqual(surface.execution, {
    location: 'remote',
    backend: 'container',
    runtimeClass: 'container-fast',
    transport: 'rust-daemon',
    snapshotState: 'snapshot-backed',
  });
  assert.deepEqual(surface.observability, {
    readiness: 'needs_attention',
    warnings: 2,
    sinkProviders: ['wandb'],
  });
  assert.deepEqual(surface.recommendation, {
    nextAction: 'review-output',
  });
});
