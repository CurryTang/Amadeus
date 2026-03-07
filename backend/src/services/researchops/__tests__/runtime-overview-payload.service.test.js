'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRuntimeOverviewPayload } = require('../runtime-overview-payload.service');

test('buildRuntimeOverviewPayload aggregates daemon, rust, and runner views with follow-up actions', () => {
  const payload = buildRuntimeOverviewPayload({
    daemons: {
      items: [
        {
          id: 'srv_client_1',
          hostname: 'client-host',
          status: 'ONLINE',
          execution: { location: 'client' },
        },
      ],
      limit: 100,
    },
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      endpoint: 'http://127.0.0.1:7788',
    },
    runner: {
      items: [{ runId: 'run_1' }],
    },
    refreshedAt: '2026-03-07T12:00:00.000Z',
  });

  assert.equal(payload.refreshedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(payload.daemons.items.length, 1);
  assert.equal(payload.rustDaemon.status, 'ok');
  assert.equal(payload.runner.items.length, 1);
  assert.deepEqual(payload.actions.overview, {
    method: 'GET',
    path: '/researchops/runtime/overview',
  });
  assert.deepEqual(payload.actions.daemons, {
    method: 'GET',
    path: '/researchops/daemons',
  });
  assert.deepEqual(payload.actions.rustDaemonStatus, {
    method: 'GET',
    path: '/researchops/daemons/rust/status',
  });
});
