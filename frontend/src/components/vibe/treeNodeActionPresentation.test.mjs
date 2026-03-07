import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeNodeActionMessage } from './treeNodeActionPresentation.js';

test('buildTreeNodeActionMessage formats approve and promote actions', () => {
  assert.equal(
    buildTreeNodeActionMessage('approve_gate', { nodeTitle: 'Scope Gate' }),
    'Approved gate for Scope Gate.'
  );
  assert.equal(
    buildTreeNodeActionMessage('promote', { nodeTitle: 'Search Branch', trialId: 'trial_7' }),
    'Promoted winner trial_7 from Search Branch.'
  );
});

test('buildTreeNodeActionMessage falls back to a generic action message', () => {
  assert.equal(
    buildTreeNodeActionMessage('refresh_search', { nodeTitle: 'Search Branch' }),
    'Completed refresh_search for Search Branch.'
  );
});
