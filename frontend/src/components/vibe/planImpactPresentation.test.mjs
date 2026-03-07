import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPlanImpactRows } from './planImpactPresentation.js';

test('buildPlanImpactRows summarizes counts and key blockers from plan patch impact', () => {
  const rows = buildPlanImpactRows({
    summary: {
      added: 1,
      removed: 0,
      changed: 2,
      blocked: 1,
      immutableTouched: 1,
    },
    blocked: [
      {
        nodeId: 'node_gate',
        blockedBy: 'manual_approve',
        blockedStatus: 'PENDING',
      },
    ],
    immutableTouched: [
      {
        nodeId: 'node_running',
        status: 'RUNNING',
      },
    ],
  });

  assert.deepEqual(rows, [
    { label: 'Changes', value: '1 added · 2 changed' },
    { label: 'Blocked', value: '1 node · node_gate by manual_approve' },
    { label: 'Immutable', value: '1 touched · node_running (RUNNING)' },
  ]);
});

test('buildPlanImpactRows omits empty sections when there is no impact', () => {
  assert.deepEqual(buildPlanImpactRows(null), []);
});
