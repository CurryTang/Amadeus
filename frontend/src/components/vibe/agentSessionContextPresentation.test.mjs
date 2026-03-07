import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAgentSessionContextSummary } from './agentSessionContextPresentation.js';

test('buildAgentSessionContextSummary returns compact routed context rows', () => {
  const rows = buildAgentSessionContextSummary({
    mode: 'routed',
    goalTitle: 'Baseline Root',
    selectedItemCount: 4,
    topBuckets: ['same_step_history', 'repo_map'],
    roleBudgetTokens: { runner: 3200, coder: 2400 },
  });

  assert.deepEqual(rows, [
    { label: 'Goal', value: 'Baseline Root' },
    { label: 'Selected', value: '4 items' },
    { label: 'Buckets', value: 'same_step_history, repo_map' },
    { label: 'Budgets', value: 'runner 3200 · coder 2400' },
  ]);
});

test('buildAgentSessionContextSummary omits mode-only legacy views', () => {
  const rows = buildAgentSessionContextSummary({
    mode: 'legacy',
    groupCount: 2,
    documentCount: 3,
    assetCount: 1,
  });

  assert.deepEqual(rows, [
    { label: 'Knowledge', value: '2 groups · 3 docs · 1 assets' },
  ]);
});
