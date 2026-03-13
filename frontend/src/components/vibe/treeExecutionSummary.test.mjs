import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTreeExecutionSummary,
  getPrimaryTreeAction,
} from './treeExecutionSummary.js';

test('buildTreeExecutionSummary groups nodes into execution-readable buckets', () => {
  const summary = buildTreeExecutionSummary(
    {
      nodes: [
        { id: 'node_running', checks: [] },
        { id: 'node_done', checks: [] },
        { id: 'node_failed', checks: [] },
        { id: 'node_gate', checks: [{ type: 'manual_approve' }] },
      ],
    },
    {
      nodes: {
        node_running: { status: 'RUNNING' },
        node_done: { status: 'PASSED' },
        node_failed: { status: 'FAILED' },
        node_gate: { status: 'BLOCKED', manualApproved: false },
      },
    }
  );

  assert.deepEqual(summary, {
    running: 1,
    needsReview: 1,
    done: 1,
    failed: 1,
  });
});

test('getPrimaryTreeAction maps node state to one clear next action', () => {
  assert.equal(
    getPrimaryTreeAction({ id: 'planned', checks: [] }, { status: 'PLANNED' }),
    'Start'
  );
  assert.equal(
    getPrimaryTreeAction({ id: 'failed', checks: [] }, { status: 'FAILED', lastRunId: 'run_1' }),
    'Resume'
  );
  assert.equal(
    getPrimaryTreeAction({ id: 'gate', checks: [{ type: 'manual_approve' }] }, { status: 'BLOCKED', manualApproved: false }),
    'Approve'
  );
  assert.equal(
    getPrimaryTreeAction({ id: 'running', checks: [] }, { status: 'RUNNING', lastRunId: 'run_2' }),
    'View Run'
  );
  assert.equal(
    getPrimaryTreeAction({ id: 'judge_running', checks: [] }, { status: 'SUCCEEDED', judge: { status: 'running' } }),
    'Awaiting judge'
  );
  assert.equal(
    getPrimaryTreeAction({ id: 'judge_review', checks: [] }, { status: 'BLOCKED', judge: { status: 'needs_review' } }),
    'Review judge'
  );
});
