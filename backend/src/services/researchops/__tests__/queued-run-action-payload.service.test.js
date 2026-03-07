'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQueuedRunActionPayload } = require('../queued-run-action-payload.service');

test('buildQueuedRunActionPayload keeps action metadata while exposing attempt semantics', () => {
  const run = {
    id: 'run_augment',
    projectId: 'proj_1',
    provider: 'codex_cli',
    status: 'QUEUED',
    metadata: {
      treeNodeId: '',
      runSource: 'augment',
    },
  };

  const payload = buildQueuedRunActionPayload({
    success: true,
    message: 'Augmentation run queued',
    run,
  });

  assert.equal(payload.success, true);
  assert.equal(payload.message, 'Augmentation run queued');
  assert.equal(payload.run, run);
  assert.equal(payload.attempt.id, 'run_augment');
  assert.equal(payload.attempt.status, 'QUEUED');
});
