import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSearchTrialRows } from './searchPresentation.js';

test('buildSearchTrialRows sorts trials by reward and formats leaderboard rows', () => {
  const rows = buildSearchTrialRows({
    trials: [
      { id: 'trial_b', status: 'RUNNING', reward: 0.6, runId: '' },
      { id: 'trial_a', status: 'PASSED', reward: 1.25, runId: 'run_1' },
      { id: 'trial_c', status: 'FAILED', reward: 0.1, runId: 'run_3' },
    ],
  });

  assert.deepEqual(rows, [
    {
      id: 'trial_a',
      title: 'trial_a',
      meta: 'PASSED · reward 1.250',
      code: 'run_1',
    },
    {
      id: 'trial_b',
      title: 'trial_b',
      meta: 'RUNNING · reward 0.600',
      code: '-',
    },
    {
      id: 'trial_c',
      title: 'trial_c',
      meta: 'FAILED · reward 0.100',
      code: 'run_3',
    },
  ]);
});

test('buildSearchTrialRows limits rows and ignores invalid trial data', () => {
  const rows = buildSearchTrialRows({
    trials: [
      null,
      { id: '', reward: 9 },
      { id: 'trial_1', status: '', reward: 'nope', runId: '' },
      { id: 'trial_2', status: 'PASSED', reward: 2.5, runId: '' },
    ],
  }, { limit: 1 });

  assert.deepEqual(rows, [
    {
      id: 'trial_2',
      title: 'trial_2',
      meta: 'PASSED · reward 2.500',
      code: '-',
    },
  ]);
});
