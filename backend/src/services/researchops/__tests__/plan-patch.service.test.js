'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculateImpact,
  validatePlanGraph,
} = require('../plan-patch.service');

test('validatePlanGraph warns when a search node is missing search config', () => {
  const validation = validatePlanGraph({
    version: 1,
    project: 'Demo',
    nodes: [
      {
        id: 'node_search',
        title: 'Search branch',
        kind: 'search',
      },
    ],
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.warnings.length, 1);
  assert.equal(validation.warnings[0].code, 'SEARCH_CONFIG_MISSING');
});

test('calculateImpact marks manual-approval nodes as blocked when previewing a gated plan', () => {
  const result = calculateImpact(
    {
      version: 1,
      project: 'Demo',
      nodes: [],
    },
    {
      version: 1,
      project: 'Demo',
      nodes: [
        {
          id: 'node_gate',
          title: 'Gate node',
          kind: 'milestone',
          checks: [{ type: 'manual_approve', name: 'scope_review' }],
        },
      ],
    },
    {
      nodes: {
        node_gate: {
          manualApproved: false,
          status: 'BLOCKED',
        },
      },
    }
  );

  assert.deepEqual(result.blocked, [
    {
      nodeId: 'node_gate',
      blockedBy: 'manual_approve',
      blockedStatus: 'PENDING',
    },
  ]);
  assert.equal(result.summary.blocked, 1);
});
