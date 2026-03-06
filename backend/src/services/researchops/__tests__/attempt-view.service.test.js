'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAttemptViewFromRun,
  buildNodeAttemptSummary,
} = require('../attempt-view.service');

const BASE_RUN = {
  id: 'run_123',
  projectId: 'proj_1',
  provider: 'codex',
  runType: 'EXPERIMENT',
  status: 'running',
  createdAt: '2026-03-06T12:00:00.000Z',
  startedAt: '2026-03-06T12:01:00.000Z',
  endedAt: '',
  metadata: {
    treeNodeId: 'baseline_root',
    treeNodeTitle: 'Baseline Root',
    runSource: 'run-step',
  },
};

test('buildAttemptViewFromRun maps a run into the v1 attempt read model', () => {
  const result = buildAttemptViewFromRun(BASE_RUN);

  assert.deepEqual(result, {
    id: 'run_123',
    runId: 'run_123',
    projectId: 'proj_1',
    nodeId: 'baseline_root',
    treeNodeId: 'baseline_root',
    treeNodeTitle: 'Baseline Root',
    status: 'RUNNING',
    provider: 'codex',
    runType: 'EXPERIMENT',
    runSource: 'run-step',
    createdAt: '2026-03-06T12:00:00.000Z',
    startedAt: '2026-03-06T12:01:00.000Z',
    endedAt: '',
  });
});

test('buildNodeAttemptSummary keeps node linkage and avoids bundle semantics', () => {
  const result = buildNodeAttemptSummary(BASE_RUN);

  assert.deepEqual(result, {
    attemptId: 'run_123',
    runId: 'run_123',
    nodeId: 'baseline_root',
    treeNodeTitle: 'Baseline Root',
    status: 'RUNNING',
    runSource: 'run-step',
    createdAt: '2026-03-06T12:00:00.000Z',
  });
});
