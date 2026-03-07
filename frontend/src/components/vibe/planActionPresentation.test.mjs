import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanActionMessage } from './planActionPresentation.js';

test('buildPlanActionMessage summarizes patch application with impact counts', () => {
  const message = buildPlanActionMessage('patch', {
    applied: [{ op: 'add_node' }, { op: 'move_node' }],
    impact: {
      summary: {
        added: 1,
        removed: 0,
        changed: 2,
      },
    },
  });

  assert.equal(message, 'Applied 2 plan patches. Impact: 1 added, 2 changed.');
});

test('buildPlanActionMessage summarizes validation and save flows', () => {
  assert.equal(
    buildPlanActionMessage('validate', { valid: true }),
    'Plan validation passed.'
  );
  assert.equal(
    buildPlanActionMessage('save', { validation: { valid: true } }),
    'Tree plan saved.'
  );
});
