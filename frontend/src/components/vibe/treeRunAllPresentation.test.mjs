import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeRunAllMessage } from './treeRunAllPresentation.js';

test('buildTreeRunAllMessage summarizes queued and blocked nodes', () => {
  const message = buildTreeRunAllMessage({
    scope: 'active_path',
    summary: {
      scopedNodes: 5,
      queued: 3,
      blocked: 2,
    },
  });

  assert.equal(message, 'Run-all queued 3 of 5 nodes; 2 blocked.');
});

test('buildTreeRunAllMessage returns a fallback for empty responses', () => {
  assert.equal(buildTreeRunAllMessage(null), 'Run-all request submitted.');
});
