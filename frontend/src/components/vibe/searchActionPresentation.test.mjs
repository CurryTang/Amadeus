import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSearchActionMessage } from './searchActionPresentation.js';

test('buildSearchActionMessage summarizes refreshed search trials', () => {
  const message = buildSearchActionMessage('refresh', {
    nodeId: 'node_search',
    search: {
      trials: [{}, {}, {}],
    },
  });

  assert.equal(message, 'Refreshed search node_search with 3 trials.');
});

test('buildSearchActionMessage falls back when no trials are present', () => {
  const message = buildSearchActionMessage('refresh', {
    nodeId: 'node_search',
    search: {},
  });

  assert.equal(message, 'Refreshed search node_search.');
});
