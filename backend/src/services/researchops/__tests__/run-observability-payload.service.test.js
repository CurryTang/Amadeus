'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunObservabilityPayload } = require('../run-observability-payload.service');

test('buildRunObservabilityPayload keeps current run-centered observability view lightweight', () => {
  const payload = buildRunObservabilityPayload({
    report: {
      run: {
        id: 'run_1',
        status: 'SUCCEEDED',
      },
      attempt: {
        treeNodeId: 'node_eval',
      },
      execution: {
        backend: 'container',
      },
      followUp: {
        parentRunId: 'run_0',
      },
      contract: {
        ok: false,
      },
      highlights: {
        deliverableArtifactIds: ['art_summary'],
      },
      observability: {
        counts: {
          warnings: 2,
        },
        statuses: {
          readiness: 'needs_attention',
        },
      },
    },
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.status, 'SUCCEEDED');
  assert.equal(payload.contract.ok, false);
  assert.equal(payload.observability.statuses.readiness, 'needs_attention');
  assert.deepEqual(payload.actions, {
    report: {
      method: 'GET',
      path: '/researchops/runs/run_1/report',
    },
    observability: {
      method: 'GET',
      path: '/researchops/runs/run_1/observability',
    },
    artifacts: {
      method: 'GET',
      path: '/researchops/runs/run_1/artifacts',
    },
    checkpoints: {
      method: 'GET',
      path: '/researchops/runs/run_1/checkpoints',
    },
    events: {
      method: 'GET',
      path: '/researchops/runs/run_1/events',
    },
    bridgeReport: {
      method: 'GET',
      path: '/researchops/runs/run_1/bridge-report',
    },
  });
});
