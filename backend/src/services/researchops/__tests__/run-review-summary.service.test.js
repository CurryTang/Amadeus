'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunReviewSummary } = require('../run-review-summary.service');

test('buildRunReviewSummary groups active, completed, and attention runs', () => {
  const payload = buildRunReviewSummary([
    { id: 'run_active', status: 'RUNNING', execution: { location: 'remote' }, metadata: { localSnapshot: { kind: 'workspace_patch' } } },
    { id: 'run_done', status: 'SUCCEEDED', execution: { location: 'local' } },
    { id: 'run_failed', status: 'FAILED', execution: { location: 'remote' } },
    { id: 'run_contract', status: 'SUCCEEDED', contract: { ok: false }, metadata: { localSnapshot: { kind: 'workspace_patch' } } },
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
    remoteExecutionCount: 2,
    snapshotBackedCount: 2,
    status: 'needs_attention',
  });
});
