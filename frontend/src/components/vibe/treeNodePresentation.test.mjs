import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTreeNodeKindLabel,
  hasManualGate,
  isObservedTreeNode,
  isSearchTreeNode,
} from './treeNodePresentation.js';

test('tree node presentation helpers normalize observed and search nodes', () => {
  assert.equal(isObservedTreeNode({ kind: 'observed_agent' }), true);
  assert.equal(isSearchTreeNode({ kind: 'search' }), true);
  assert.equal(getTreeNodeKindLabel({ kind: 'observed_agent' }), 'OBSERVED');
  assert.equal(getTreeNodeKindLabel({ kind: 'search' }), 'SEARCH');
});

test('tree node presentation helpers detect manual gates and fallback labels', () => {
  assert.equal(hasManualGate({ checks: [{ type: 'manual_approve' }] }), true);
  assert.equal(hasManualGate({ checks: [{ type: 'unit_tests' }] }), false);
  assert.equal(getTreeNodeKindLabel({ kind: 'knowledge' }), 'KNOWLEDGE');
  assert.equal(getTreeNodeKindLabel({}), 'TOPIC');
});
