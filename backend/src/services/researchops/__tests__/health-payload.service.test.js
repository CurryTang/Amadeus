'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildResearchOpsHealthPayload } = require('../health-payload.service');

test('buildResearchOpsHealthPayload preserves health roots and adds a stable status action', () => {
  const payload = buildResearchOpsHealthPayload({
    storeMode: 'mongo',
    running: 2,
    timestamp: '2026-03-06T13:00:00.000Z',
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      endpoint: 'http://127.0.0.1:7788',
      runtime: {
        task_catalog_version: 'v0',
      },
    },
  });

  assert.equal(payload.status, 'ok');
  assert.equal(payload.storeMode, 'mongo');
  assert.equal(payload.running, 2);
  assert.equal(payload.timestamp, '2026-03-06T13:00:00.000Z');
  assert.equal(payload.rustDaemon.status, 'ok');
  assert.equal(payload.rustDaemon.transport, 'http');
  assert.equal(payload.rustDaemon.endpoint, 'http://127.0.0.1:7788');
  assert.equal(payload.rustDaemon.runtime.task_catalog_version, 'v0');
  assert.deepEqual(payload.actions.health, {
    method: 'GET',
    path: '/api/researchops/health',
  });
});
