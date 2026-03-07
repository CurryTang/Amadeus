import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecentRunReviewSummary,
  buildRecentRunCards,
  buildContinuationChip,
  filterRunsForSelectedNode,
  getRunSourceLabel,
} from './runPresentation.js';

test('buildRecentRunCards sorts newest runs first and exposes source labels', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_old',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T10:00:00.000Z',
      metadata: {
        prompt: 'Old launcher run',
        sourceType: 'launcher',
      },
    },
    {
      id: 'run_new',
      status: 'RUNNING',
      runType: 'EXPERIMENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        experimentCommand: 'python train.py',
        sourceType: 'tree',
        treeNodeTitle: 'Ablation branch',
      },
    },
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, 'run_new');
  assert.equal(cards[0].sourceLabel, 'Tree');
  assert.equal(cards[0].title, 'python train.py');
  assert.equal(cards[1].id, 'run_old');
  assert.equal(cards[1].sourceLabel, 'Launcher');
});

test('buildRecentRunCards can read linked node titles from attempt-shaped runs', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_attempt',
      status: 'SUCCEEDED',
      runType: 'EXPERIMENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        experimentCommand: 'python eval.py',
      },
      attempt: {
        treeNodeId: 'node_eval',
        treeNodeTitle: 'Evaluation branch',
      },
    },
  ]);

  assert.equal(cards[0].sourceLabel, 'Tree');
  assert.equal(cards[0].linkedNodeTitle, 'Evaluation branch');
});

test('getRunSourceLabel falls back to linked entities when sourceType is absent', () => {
  assert.equal(getRunSourceLabel({ metadata: { treeNodeId: 'node_a' } }), 'Tree');
  assert.equal(getRunSourceLabel({ metadata: { todoId: 'todo_a' } }), 'TODO');
  assert.equal(getRunSourceLabel({ metadata: {} }), 'Launcher');
});

test('buildContinuationChip prefers the run title and keeps the run id', () => {
  const chip = buildContinuationChip({
    id: 'run_ctx',
    metadata: {
      prompt: 'Investigate benchmark drift',
    },
  });

  assert.deepEqual(chip, {
    id: 'run_ctx',
    runId: 'run_ctx',
    label: 'Using run: Investigate benchmark drift',
  });
});

test('filterRunsForSelectedNode narrows to the active node but falls back when empty', () => {
  const runs = [
    {
      id: 'run_a',
      metadata: { treeNodeId: 'node_a' },
    },
    {
      id: 'run_b',
      attempt: { nodeId: 'node_b' },
    },
  ];

  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_a').map((item) => item.id), ['run_a']);
  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_b').map((item) => item.id), ['run_b']);
  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_missing').map((item) => item.id), ['run_a', 'run_b']);
});

test('buildRecentRunReviewSummary groups active and attention states for activity headers', () => {
  const summary = buildRecentRunReviewSummary([
    { id: 'run_a', status: 'RUNNING', execution: { location: 'remote' }, metadata: { localSnapshot: { kind: 'workspace_patch' } } },
    { id: 'run_b', status: 'FAILED', execution: { location: 'remote' } },
    { id: 'run_c', status: 'SUCCEEDED', contract: { ok: false }, metadata: { localSnapshot: { kind: 'workspace_patch' } } },
    { id: 'run_d', status: 'CANCELLED' },
  ]);

  assert.deepEqual(summary, {
    totalCount: 4,
    activeCount: 1,
    attentionCount: 3,
    completedCount: 1,
    failedCount: 1,
    cancelledCount: 1,
    contractFailureCount: 1,
    remoteExecutionCount: 2,
    snapshotBackedCount: 2,
    status: 'needs_attention',
  });
});
