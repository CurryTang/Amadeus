import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeQueueActionMessage } from './treeQueueActionPresentation.js';

test('buildTreeQueueActionMessage summarizes pause, resume, and abort actions', () => {
  assert.equal(buildTreeQueueActionMessage('pause'), 'Tree queue paused.');
  assert.equal(buildTreeQueueActionMessage('resume'), 'Tree queue resumed.');
  assert.equal(buildTreeQueueActionMessage('abort'), 'Tree queue aborted.');
});

test('buildTreeQueueActionMessage falls back to a generic queue action message', () => {
  assert.equal(buildTreeQueueActionMessage('refresh'), 'Tree queue refresh completed.');
});
