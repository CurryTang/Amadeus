'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRustDaemonStatusPayload,
} = require('../rust-daemon-status-payload.service');

test('buildRustDaemonStatusPayload preserves probe roots and exposes runtime options/actions', () => {
  const payload = buildRustDaemonStatusPayload({
    apiBaseUrl: 'https://example.com/api',
    refreshedAt: '2026-03-07T12:00:00.000Z',
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      endpoint: 'http://127.0.0.1:7788',
      hostReady: true,
      containerReady: false,
      healthState: 'degraded',
      lastFailureReason: 'docker unavailable',
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
  assert.equal(payload.refreshedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(payload.runtime.task_catalog_version, 'v0');
  assert.equal(payload.taskCatalog.version, 'v0');
  assert.equal(payload.catalogParity.status, 'aligned');
  assert.equal(payload.hostReady, true);
  assert.equal(payload.containerReady, false);
  assert.equal(payload.healthState, 'degraded');
  assert.equal(payload.lastFailureReason, 'docker unavailable');
  assert.equal(payload.supervisor.mode, 'unmanaged');
  assert.equal(payload.supervisor.running, false);
  assert.equal(payload.supervisor.desiredState, 'stopped');
  assert.equal(payload.runtimeOptions.rustDaemonPrototype.runtime, 'rust');
  assert.match(payload.runtimeOptions.rustDaemonPrototype.commands.http, /researchops-bootstrap-rust-daemon\.sh/);
  assert.match(payload.runtimeOptions.rustDaemonPrototype.commands.launcher, /researchops:rust-daemon/);
  assert.match(payload.runtimeOptions.rustDaemonPrototype.commands.background, /nohup cargo .*--manifest-path/);
  assert.match(payload.runtimeOptions.rustDaemonPrototype.commands.verify, /researchops:verify-rust-daemon-prototype/);
  assert.match(payload.runtimeOptions.rustDaemonPrototype.supervisorPaths.pidFile, /rust-daemon\.pid/);
  assert.match(payload.debugCommands.health, /curl .*\/health/);
  assert.match(payload.debugCommands.runtime, /curl .*\/runtime/);
  assert.match(payload.debugCommands.taskCatalog, /curl .*\/task-catalog/);
  assert.match(payload.debugCommands.snapshotCapture, /bridge\.captureWorkspaceSnapshot/);
  assert.deepEqual(payload.actions.status, {
    method: 'GET',
    path: '/researchops/daemons/rust/status',
  });
  assert.deepEqual(payload.actions.enableManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/enable-managed',
  });
  assert.deepEqual(payload.actions.disableManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/disable-managed',
  });
  assert.deepEqual(payload.actions.reconcileManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/reconcile',
  });
  assert.deepEqual(payload.actions.bootstrap, {
    method: 'POST',
    path: '/researchops/daemons/bootstrap',
  });
});
