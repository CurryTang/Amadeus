'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDefaultState,
  normalizeState,
  setNodeState,
  appendQueueItem,
  setQueuePaused,
} = require('../tree-state.service');

test('normalizeState preserves tree-state structure and defaults missing containers', () => {
  const state = normalizeState({
    nodes: null,
    queue: { paused: true, items: null },
    search: null,
  });

  assert.deepEqual(Object.keys(state.nodes), []);
  assert.equal(state.queue.paused, true);
  assert.deepEqual(state.queue.items, []);
  assert.deepEqual(state.search, {});
  assert.equal(typeof state.updatedAt, 'string');
});

test('setNodeState normalizes status and node-scoped runtime fields', () => {
  const next = setNodeState(buildDefaultState(), 'node_eval', {
    status: 'running',
    manualApproved: 1,
    search: ['invalid-shape'],
    lastRunId: 'run_123',
  });

  assert.deepEqual(next.nodes.node_eval, {
    status: 'RUNNING',
    manualApproved: true,
    search: {},
    lastRunId: 'run_123',
    updatedAt: next.nodes.node_eval.updatedAt,
  });
  assert.equal(typeof next.nodes.node_eval.updatedAt, 'string');
  assert.equal(typeof next.updatedAt, 'string');
});

test('setNodeState normalizes judge loop state for a node', () => {
  const next = setNodeState(buildDefaultState(), 'node_eval', {
    judge: {
      status: ' revise ',
      mode: ' AUTO ',
      iteration: '2',
      maxIterations: '5',
      lastRunId: 'run_eval_2',
      summary: 'Needs another pass',
      issues: ['missing citation', '', null],
      refinementPrompt: 'Add citation support',
      history: [{ verdict: 'pass' }, 'invalid-entry'],
    },
  });

  assert.deepEqual(next.nodes.node_eval.judge, {
    status: 'revise',
    mode: 'auto',
    iteration: 2,
    maxIterations: 5,
    lastRunId: 'run_eval_2',
    summary: 'Needs another pass',
    issues: ['missing citation'],
    refinementPrompt: 'Add citation support',
    history: [{ verdict: 'pass' }],
  });
});

test('appendQueueItem stamps queuedAt and keeps only the newest thousand items', () => {
  let state = buildDefaultState();
  for (let index = 0; index < 1002; index += 1) {
    state = appendQueueItem(state, { id: `item_${index}` });
  }

  assert.equal(state.queue.items.length, 1000);
  assert.equal(state.queue.items[0].id, 'item_2');
  assert.equal(typeof state.queue.items[0].queuedAt, 'string');
  assert.equal(typeof state.queue.updatedAt, 'string');
});

test('setQueuePaused stores the pause flag and sanitized reason', () => {
  const next = setQueuePaused(buildDefaultState(), true, '  waiting for review  ');

  assert.equal(next.queue.paused, true);
  assert.equal(next.queue.pausedReason, 'waiting for review');
  assert.equal(typeof next.queue.updatedAt, 'string');
});
