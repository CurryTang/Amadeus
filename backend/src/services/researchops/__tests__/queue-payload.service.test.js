'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildQueueListPayload } = require('../queue-payload.service');

test('buildQueueListPayload preserves queued run items while exposing filters and actions', () => {
  const payload = buildQueueListPayload({
    items: [
      {
        id: 'run_q_1',
        projectId: 'proj_1',
        serverId: 'srv_client_1',
        provider: 'codex',
        runType: 'AGENT',
        status: 'QUEUED',
        metadata: {
          treeNodeId: 'node_1',
          treeNodeTitle: 'Investigate issue',
        },
      },
    ],
    serverId: 'srv_client_1',
    limit: 50,
  });

  assert.equal(payload.limit, 50);
  assert.equal(payload.filters.serverId, 'srv_client_1');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'run_q_1');
  assert.equal(payload.items[0].attempt.treeNodeId, 'node_1');
  assert.equal(payload.items[0].execution.serverId, 'srv_client_1');
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/scheduler/queue',
  });
});
