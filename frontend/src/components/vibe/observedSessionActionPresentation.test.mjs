import test from 'node:test';
import assert from 'node:assert/strict';

import { buildObservedSessionActionMessage } from './observedSessionActionPresentation.js';

test('buildObservedSessionActionMessage summarizes refresh using detached node title when present', () => {
  const message = buildObservedSessionActionMessage('refresh', {
    item: {
      detachedNodeTitle: 'Remote agent task',
    },
  });

  assert.equal(message, 'Refreshed observed session for Remote agent task.');
});

test('buildObservedSessionActionMessage falls back to session id when no title exists', () => {
  const message = buildObservedSessionActionMessage('refresh', {
    item: {
      id: 'obs_12',
    },
  });

  assert.equal(message, 'Refreshed observed session for obs_12.');
});
