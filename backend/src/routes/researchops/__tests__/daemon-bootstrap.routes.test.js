'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDaemonBootstrapResponse,
  buildDaemonBootstrapStatusPayload,
  buildRustDaemonStatusResponse,
  buildRuntimeCatalogResponse,
} = require('../admin');

test('bootstrap create route returns token metadata and install payload', async () => {
  const response = createDaemonBootstrapResponse({
    bootstrap: {
      bootstrapId: 'dbt_123',
      secret: 'secret-value',
      expiresAt: '2026-03-05T18:00:00.000Z',
    },
    apiBaseUrl: 'https://example.com/api',
    requestedHostname: 'alice-mbp',
  });

  assert.equal(response.bootstrapId, 'dbt_123');
  assert.equal(response.secret, 'secret-value');
  assert.equal(response.apiBaseUrl, 'https://example.com/api');
  assert.match(response.installCommand, /RESEARCHOPS_BOOTSTRAP_SECRET='secret-value'/);
  assert.equal(response.bootstrapFile.bootstrapId, 'dbt_123');
  assert.equal(response.runtimeOptions?.rustDaemonPrototype?.runtime, 'rust');
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.commands?.http || '', /researchops-bootstrap-rust-daemon\.sh/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.commands?.http || '', /RESEARCHOPS_RUST_DAEMON_TRANSPORT='http'/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.commands?.unix || '', /researchops-bootstrap-rust-daemon\.sh/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.commands?.unix || '', /RESEARCHOPS_RUST_DAEMON_TRANSPORT='unix'/);
  assert.equal(response.runtimeOptions?.rustDaemonPrototype?.env?.RESEARCHOPS_API_BASE_URL, 'https://example.com/api');
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.envFiles?.http?.content || '', /RESEARCHOPS_RUST_DAEMON_TRANSPORT=http/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.envFiles?.http?.content || '', /RESEARCHOPS_API_BASE_URL=https:\/\/example.com\/api/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.envFiles?.unix?.content || '', /RESEARCHOPS_RUST_DAEMON_TRANSPORT=unix/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.envFiles?.unix?.content || '', /RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET=\/tmp\/researchops-local-daemon\.sock/);
  assert.deepEqual(response.actions.bootstrapStatus, {
    method: 'GET',
    path: '/researchops/daemons/bootstrap/dbt_123',
  });
  assert.deepEqual(response.actions.registerDaemon, {
    method: 'POST',
    path: '/researchops/daemons/register',
  });
  assert.deepEqual(response.submitHints.registerDaemon.body, {
    hostname: 'string',
    status: 'string',
    labels: 'object',
    bootstrapId: 'string',
    bootstrapSecret: 'string',
  });
});

test('bootstrap status payload keeps discovery metadata without leaking install secrets', async () => {
  const response = buildDaemonBootstrapStatusPayload({
    bootstrap: {
      bootstrapId: 'dbt_123',
      status: 'REDEEMED',
      expiresAt: '2026-03-05T18:00:00.000Z',
      redeemedAt: '2026-03-05T17:30:00.000Z',
      redeemedServerId: 'srv_client_1',
      requestedHostname: 'alice-mbp',
    },
  });

  assert.equal(response.bootstrapId, 'dbt_123');
  assert.equal(response.status, 'REDEEMED');
  assert.equal(response.redeemedAt, '2026-03-05T17:30:00.000Z');
  assert.equal(response.redeemedServerId, 'srv_client_1');
  assert.equal(response.secret, undefined);
  assert.equal(response.installCommand, undefined);
  assert.equal(response.bootstrapFile, undefined);
  assert.equal(response.runtimeOptions, undefined);
  assert.deepEqual(response.actions.bootstrapStatus, {
    method: 'GET',
    path: '/researchops/daemons/bootstrap/dbt_123',
  });
  assert.deepEqual(response.actions.registerDaemon, {
    method: 'POST',
    path: '/researchops/daemons/register',
  });
});

test('rust daemon status response exposes runtime probe data and reusable runtime options', async () => {
  const response = buildRustDaemonStatusResponse({
    apiBaseUrl: 'https://example.com/api',
    refreshedAt: '2026-03-07T12:00:00.000Z',
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'unix',
      socketPath: '/tmp/researchops-local-daemon.sock',
      hostReady: true,
      containerReady: false,
      healthState: 'degraded',
      lastFailureReason: 'docker unavailable',
      runtime: {
        task_catalog_version: 'v0',
        supports_local_bridge_workflow: true,
      },
      taskCatalog: {
        version: 'v0',
        tasks: [{ task_type: 'project.checkPath' }],
      },
      catalogParity: {
        status: 'mismatch',
        missingTaskTypes: ['bridge.submitRunNote'],
        extraTaskTypes: [],
      },
    },
  });

  assert.equal(response.enabled, true);
  assert.equal(response.status, 'ok');
  assert.equal(response.refreshedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(response.transport, 'unix');
  assert.equal(response.socketPath, '/tmp/researchops-local-daemon.sock');
  assert.equal(response.hostReady, true);
  assert.equal(response.containerReady, false);
  assert.equal(response.healthState, 'degraded');
  assert.equal(response.lastFailureReason, 'docker unavailable');
  assert.equal(response.runtime.task_catalog_version, 'v0');
  assert.equal(response.taskCatalog.version, 'v0');
  assert.equal(response.catalogParity.status, 'mismatch');
  assert.deepEqual(response.actions.status, {
    method: 'GET',
    path: '/researchops/daemons/rust/status',
  });
  assert.deepEqual(response.actions.start, {
    method: 'POST',
    path: '/researchops/daemons/rust/start',
  });
  assert.deepEqual(response.actions.stop, {
    method: 'POST',
    path: '/researchops/daemons/rust/stop',
  });
  assert.deepEqual(response.actions.enableManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/enable-managed',
  });
  assert.deepEqual(response.actions.disableManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/disable-managed',
  });
  assert.deepEqual(response.actions.reconcileManaged, {
    method: 'POST',
    path: '/researchops/daemons/rust/reconcile',
  });
  assert.deepEqual(response.actions.restart, {
    method: 'POST',
    path: '/researchops/daemons/rust/restart',
  });
  assert.deepEqual(response.actions.health, {
    method: 'GET',
    path: '/researchops/health',
  });
  assert.equal(response.runtimeOptions?.rustDaemonPrototype?.runtime, 'rust');
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.commands?.http || '', /researchops-bootstrap-rust-daemon\.sh/);
  assert.match(response.runtimeOptions?.rustDaemonPrototype?.envFiles?.unix?.content || '', /RESEARCHOPS_RUST_DAEMON_TRANSPORT=unix/);
  assert.match(response.debugCommands?.health || '', /curl --unix-socket .* http:\/\/localhost\/health/);
  assert.match(response.debugCommands?.runtime || '', /curl --unix-socket .* http:\/\/localhost\/runtime/);
  assert.match(response.debugCommands?.taskCatalog || '', /curl --unix-socket .* http:\/\/localhost\/task-catalog/);
});

test('runtime catalog response exposes canonical backends and runtime classes', async () => {
  const response = buildRuntimeCatalogResponse({
    refreshedAt: '2026-03-07T12:00:00.000Z',
  });

  assert.equal(response.refreshedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(response.version, 'v0');
  assert.deepEqual(response.backends.map((item) => item.id), ['local', 'container', 'k8s', 'slurm']);
  assert.deepEqual(response.runtimeClasses.map((item) => item.id), [
    'wasm-lite',
    'container-fast',
    'container-guarded',
    'microvm-strong',
  ]);
  assert.deepEqual(response.actions.catalog, {
    method: 'GET',
    path: '/researchops/runtime/catalog',
  });
  assert.deepEqual(response.actions.overview, {
    method: 'GET',
    path: '/researchops/runtime/overview',
  });
});
