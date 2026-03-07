import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActivityFeed } from './activityFeedPresentation.js';

test('buildActivityFeed returns run-only items with counts', () => {
  const result = buildActivityFeed({
    runCards: [{ id: 'run_1', title: 'Run 1' }],
    observedSessionCards: [],
  });

  assert.equal(result.runCount, 1);
  assert.equal(result.sessionCount, 0);
  assert.deepEqual(result.items.map((item) => ({ id: item.id, kind: item.kind })), [
    { id: 'run_1', kind: 'run' },
  ]);
});

test('buildActivityFeed returns session-only items with counts', () => {
  const result = buildActivityFeed({
    runCards: [],
    observedSessionCards: [{ id: 'sess_1', title: 'Session 1' }],
  });

  assert.equal(result.runCount, 0);
  assert.equal(result.sessionCount, 1);
  assert.deepEqual(result.items.map((item) => ({ id: item.id, kind: item.kind })), [
    { id: 'sess_1', kind: 'session' },
  ]);
});

test('buildActivityFeed groups runs first and sessions second', () => {
  const result = buildActivityFeed({
    runCards: [{ id: 'run_1', title: 'Run 1' }, { id: 'run_2', title: 'Run 2' }],
    observedSessionCards: [{ id: 'sess_1', title: 'Session 1' }],
  });

  assert.deepEqual(result.items.map((item) => ({ id: item.id, kind: item.kind })), [
    { id: 'run_1', kind: 'run' },
    { id: 'run_2', kind: 'run' },
    { id: 'sess_1', kind: 'session' },
  ]);
});

test('buildActivityFeed preserves raw card payload on merged items', () => {
  const runCard = { id: 'run_1', title: 'Run 1', status: 'FAILED' };
  const sessionCard = { id: 'sess_1', title: 'Session 1', status: 'RUNNING' };
  const result = buildActivityFeed({
    runCards: [runCard],
    observedSessionCards: [sessionCard],
  });

  assert.equal(result.items[0].card, runCard);
  assert.equal(result.items[1].card, sessionCard);
});

test('buildActivityFeed preserves run review summary metadata when provided', () => {
  const result = buildActivityFeed({
    runCards: [{ id: 'run_1', title: 'Run 1' }],
    observedSessionCards: [],
    runReviewSummary: {
      totalCount: 1,
      activeCount: 0,
      attentionCount: 1,
      completedCount: 0,
      status: 'needs_attention',
    },
  });

  assert.deepEqual(result.runReviewSummary, {
    totalCount: 1,
    activeCount: 0,
    attentionCount: 1,
    completedCount: 0,
    status: 'needs_attention',
  });
});
