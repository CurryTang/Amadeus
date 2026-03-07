'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunReviewSummary } = require('../run-review-summary.service');

test('buildRunReviewSummary groups active, completed, and attention runs', () => {
  const payload = buildRunReviewSummary([
    { id: 'run_active', status: 'RUNNING' },
    { id: 'run_done', status: 'SUCCEEDED' },
    { id: 'run_failed', status: 'FAILED' },
    { id: 'run_contract', status: 'SUCCEEDED', contract: { ok: false } },
    { id: 'run_cancelled', status: 'CANCELLED' },
  ]);

  assert.deepEqual(payload, {
    totalCount: 5,
    activeCount: 1,
    attentionCount: 3,
    completedCount: 2,
    failedCount: 1,
    cancelledCount: 1,
    contractFailureCount: 1,
    status: 'needs_attention',
  });
});
