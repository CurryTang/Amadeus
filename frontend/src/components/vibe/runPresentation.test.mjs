import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecentRunCards,
  buildContinuationChip,
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
