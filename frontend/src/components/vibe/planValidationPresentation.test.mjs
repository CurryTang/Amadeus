import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanValidationIssues } from './planValidationPresentation.js';

test('buildPlanValidationIssues prioritizes errors before warnings and limits the list', () => {
  const issues = buildPlanValidationIssues({
    errors: [
      { code: 'PARENT_NOT_FOUND', message: 'Node child references missing parent root' },
      { code: 'PLAN_CYCLE_DETECTED', message: 'Plan graph contains a cycle' },
    ],
    warnings: [
      { code: 'SEARCH_CONFIG_MISSING', message: 'Search node search_1 has no search block' },
      { code: 'EXTRA', message: 'Unused warning' },
    ],
  }, { limit: 3 });

  assert.deepEqual(issues, [
    { severity: 'error', code: 'PARENT_NOT_FOUND', message: 'Node child references missing parent root' },
    { severity: 'error', code: 'PLAN_CYCLE_DETECTED', message: 'Plan graph contains a cycle' },
    { severity: 'warning', code: 'SEARCH_CONFIG_MISSING', message: 'Search node search_1 has no search block' },
  ]);
});

test('buildPlanValidationIssues returns an empty list for empty validation payloads', () => {
  assert.deepEqual(buildPlanValidationIssues(null), []);
});
