import test from 'node:test';
import assert from 'node:assert/strict';

import { removeProjectRunsFromState } from './runHistoryState.js';

test('removes failed runs from both caches for the active project', () => {
  const result = removeProjectRunsFromState({
    runs: [
      { id: 'run_failed_a', projectId: 'proj_1', status: 'FAILED' },
      { id: 'run_success_a', projectId: 'proj_1', status: 'SUCCEEDED' },
      { id: 'run_failed_other', projectId: 'proj_2', status: 'FAILED' },
    ],
    runHistoryItems: [
      { id: 'run_failed_a', projectId: 'proj_1', status: 'FAILED' },
      { id: 'run_success_a', projectId: 'proj_1', status: 'SUCCEEDED' },
    ],
    projectId: 'proj_1',
    status: 'FAILED',
  });

  assert.deepEqual(result.runs.map((item) => item.id), ['run_success_a', 'run_failed_other']);
  assert.deepEqual(result.runHistoryItems.map((item) => item.id), ['run_success_a']);
});

test('removes a single run id from both caches without touching other runs', () => {
  const result = removeProjectRunsFromState({
    runs: [
      { id: 'run_1', projectId: 'proj_1', status: 'FAILED' },
      { id: 'run_2', projectId: 'proj_1', status: 'SUCCEEDED' },
      { id: 'run_3', projectId: 'proj_2', status: 'FAILED' },
    ],
    runHistoryItems: [
      { id: 'run_1', projectId: 'proj_1', status: 'FAILED' },
      { id: 'run_2', projectId: 'proj_1', status: 'SUCCEEDED' },
    ],
    projectId: 'proj_1',
    runId: 'run_1',
  });

  assert.deepEqual(result.runs.map((item) => item.id), ['run_2', 'run_3']);
  assert.deepEqual(result.runHistoryItems.map((item) => item.id), ['run_2']);
});
