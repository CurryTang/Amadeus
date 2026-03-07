'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunPayload } = require('../run-payload.service');

test('buildRunPayload keeps the run while exposing attempt semantics', () => {
  const run = {
    id: 'run_123',
    projectId: 'proj_1',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'SUCCEEDED',
    metadata: {
      treeNodeId: 'baseline_root',
      treeNodeTitle: 'Baseline Root',
      runSource: 'run-step',
    },
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.run, run);
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.attempt.status, 'SUCCEEDED');
  assert.equal('bundle' in payload, false);
});
