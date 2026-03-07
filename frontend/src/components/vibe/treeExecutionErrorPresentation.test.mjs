import test from 'node:test';
import assert from 'node:assert/strict';

import { getTreeExecutionErrorMessage } from './treeExecutionErrorPresentation.js';

test('getTreeExecutionErrorMessage formats blocked-node payloads with dependency names', () => {
  const message = getTreeExecutionErrorMessage({
    response: {
      data: {
        code: 'NODE_BLOCKED',
        error: 'Node node_eval is blocked',
        blockedBy: [
          { depId: 'node_parent', status: 'FAILED' },
          { check: 'scope_review', type: 'manual_approve', status: 'PENDING' },
        ],
      },
    },
  }, 'Failed to run node step');

  assert.equal(
    message,
    'NODE_BLOCKED: Node node_eval is blocked (node_parent, scope_review)'
  );
});

test('getTreeExecutionErrorMessage falls back to code plus message', () => {
  const message = getTreeExecutionErrorMessage({
    response: {
      data: {
        code: 'QUEUE_PAUSED',
        error: 'Queue is paused. Resume before running all steps.',
      },
    },
  }, 'Failed to run all steps');

  assert.equal(message, 'QUEUE_PAUSED: Queue is paused. Resume before running all steps.');
});
