'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunListPayload } = require('../run-list-payload.service');

test('buildRunListPayload keeps list pagination while exposing attempt-shaped items', () => {
  const run = {
    id: 'run_123',
    projectId: 'proj_1',
    serverId: 'local-default',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'SUCCEEDED',
    metadata: {
      treeNodeId: 'baseline_root',
      treeNodeTitle: 'Baseline Root',
      runSource: 'run-step',
      resultSnippet: 'Patched benchmark harness',
    },
  };

  const payload = buildRunListPayload({
    page: {
      items: [run],
      hasMore: true,
      nextCursor: 'cursor_2',
    },
    limit: 20,
    cursor: 'cursor_1',
  });

  assert.equal(payload.limit, 20);
  assert.equal(payload.cursor, 'cursor_1');
  assert.equal(payload.hasMore, true);
  assert.equal(payload.nextCursor, 'cursor_2');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].run, undefined);
  assert.equal(payload.items[0].id, 'run_123');
  assert.equal(payload.items[0].attempt.id, 'run_123');
  assert.equal(payload.items[0].attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.items[0].execution.serverId, 'local-default');
  assert.equal(payload.items[0].execution.location, 'local');
  assert.equal(payload.items[0].resultSnippet, 'Patched benchmark harness');
});
