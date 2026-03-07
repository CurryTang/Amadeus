import test from 'node:test';
import assert from 'node:assert/strict';

import { buildContextPackSummary } from './contextPackPresentation.js';

test('buildContextPackSummary returns routed context details in display order', () => {
  const rows = buildContextPackSummary({
    mode: 'routed',
    goalTitle: 'Evaluation branch',
    selectedItemCount: 6,
    topBuckets: ['same_step_history', 'relevant_interfaces'],
    roleBudgetTokens: {
      runner: 4200,
      coder: 4200,
      analyst: 2400,
      writer: 1200,
    },
  });

  assert.deepEqual(rows, [
    { label: 'Mode', value: 'routed' },
    { label: 'Goal', value: 'Evaluation branch' },
    { label: 'Selected', value: '6 items' },
    { label: 'Buckets', value: 'same_step_history, relevant_interfaces' },
    { label: 'Budgets', value: 'runner 4200 · coder 4200 · analyst 2400 · writer 1200' },
  ]);
});

test('buildContextPackSummary returns legacy knowledge counts when routed fields are absent', () => {
  const rows = buildContextPackSummary({
    mode: 'legacy',
    groupCount: 2,
    documentCount: 5,
    assetCount: 9,
    resourcePathCount: 3,
  });

  assert.deepEqual(rows, [
    { label: 'Mode', value: 'legacy' },
    { label: 'Knowledge', value: '2 groups · 5 docs · 9 assets' },
    { label: 'Hints', value: '3 paths' },
  ]);
});
