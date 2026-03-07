'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRustDaemonStatusPayload,
} = require('../rust-daemon-status-payload.service');

test('buildRustDaemonStatusPayload preserves probe roots and exposes runtime options/actions', () => {
  const payload = buildRustDaemonStatusPayload({
    apiBaseUrl: 'https://example.com/api',
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      endpoint: 'http://127.0.0.1:7788',
      runtime: {
        task_catalog_version: 'v0',
      },
      taskCatalog: {
        version: 'v0',
        tasks: [{ task_type: 'project.checkPath' }],
      },
      catalogParity: {
        status: 'aligned',
        expectedVersion: 'v0',
        actualVersion: 'v0',
        missingTaskTypes: [],
        extraTaskTypes: [],
      },
    },
  });

  assert.equal(payload.enabled, true);
  assert.equal(payload.status, 'ok');
  assert.equal(payload.transport, 'http');
  assert.equal(payload.endpoint, 'http://127.0.0.1:7788');
  assert.equal(payload.runtime.task_catalog_version, 'v0');
  assert.equal(payload.taskCatalog.version, 'v0');
  assert.equal(payload.catalogParity.status, 'aligned');
  assert.equal(payload.runtimeOptions.rustDaemonPrototype.runtime, 'rust');
  assert.match(payload.runtimeOptions.rustDaemonPrototype.commands.http, /researchops-bootstrap-rust-daemon\.sh/);
  assert.deepEqual(payload.actions.status, {
    method: 'GET',
    path: '/researchops/daemons/rust/status',
  });
  assert.deepEqual(payload.actions.bootstrap, {
    method: 'POST',
    path: '/researchops/daemons/bootstrap',
  });
});
