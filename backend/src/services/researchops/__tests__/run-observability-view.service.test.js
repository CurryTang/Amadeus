'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunObservabilityView } = require('../run-observability-view.service');

test('buildRunObservabilityView summarizes evidence, contract, sinks, and warnings', () => {
  const payload = buildRunObservabilityView({
    steps: [{ id: 'step_1' }, { id: 'step_2' }, { id: 'step_3' }],
    artifacts: [{ id: 'art_1' }, { id: 'art_2' }, { id: 'art_3' }, { id: 'art_4' }],
    checkpoints: [
      { id: 'cp_1', status: 'PENDING' },
      { id: 'cp_2', status: 'APPROVED' },
    ],
    summaryText: 'Execution complete.',
    contract: {
      ok: false,
    },
    highlights: {
      finalOutputArtifactId: 'art_4',
      deliverableArtifactIds: ['art_2', 'art_4'],
    },
    manifest: {
      summary: {
        tableCount: 1,
        figureCount: 2,
        metricArtifactCount: 1,
      },
      observability: {
        sinks: {
          wandb: { url: 'https://wandb.example/run' },
          tensorboard: { url: 'https://tb.example/run' },
        },
        warnings: ['wandb adapter failed: timeout'],
      },
    },
  });

  assert.deepEqual(payload.counts, {
    steps: 3,
    artifacts: 4,
    deliverables: 2,
    checkpoints: 2,
    pendingCheckpoints: 1,
    resolvedCheckpoints: 1,
    tables: 1,
    figures: 2,
    metrics: 1,
    sinks: 2,
    warnings: 3,
  });
  assert.deepEqual(payload.flags, {
    hasSummary: true,
    hasFinalOutput: true,
    hasDeliverables: true,
    hasPendingCheckpoints: true,
    hasContractFailures: true,
    hasWarnings: true,
    hasObservabilitySinks: true,
  });
  assert.deepEqual(payload.statuses, {
    evidence: 'present',
    checkpoints: 'pending',
    contract: 'failing',
    observability: 'warnings',
    readiness: 'needs_attention',
  });
  assert.deepEqual(payload.sinkProviders, ['tensorboard', 'wandb']);
  assert.deepEqual(payload.warnings, [
    '1 checkpoints pending review',
    'Contract validation failed',
    'wandb adapter failed: timeout',
  ]);
});

test('buildRunObservabilityView falls back to pending outputs when no evidence is available', () => {
  const payload = buildRunObservabilityView({
    steps: [],
    artifacts: [],
    checkpoints: [],
    summaryText: '',
    contract: {
      ok: null,
    },
    highlights: {
      deliverableArtifactIds: [],
    },
    manifest: {},
  });

  assert.equal(payload.statuses.readiness, 'pending_outputs');
  assert.equal(payload.statuses.contract, 'unknown');
  assert.equal(payload.flags.hasWarnings, false);
  assert.equal(payload.counts.deliverables, 0);
});
