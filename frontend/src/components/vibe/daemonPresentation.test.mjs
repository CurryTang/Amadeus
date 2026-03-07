import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBootstrapRuntimeCommands,
  buildBootstrapRuntimeEnvFiles,
  buildClientDeviceOption,
  buildRustDaemonStatusRows,
  buildRustDaemonStatusNote,
  filterOnlineClientDevices,
} from './daemonPresentation.js';

test('buildClientDeviceOption includes hostname, status, location, and bridge readiness label', () => {
  const option = buildClientDeviceOption({
    id: 'srv_1',
    hostname: 'client-host',
    status: 'ONLINE',
    execution: {
      location: 'client',
    },
    capabilities: {
      supportsLocalBridgeWorkflow: true,
    },
  });

  assert.deepEqual(option, {
    value: 'srv_1',
    label: 'client-host (ONLINE · client · bridge ready)',
  });
});

test('filterOnlineClientDevices keeps online devices only', () => {
  const items = filterOnlineClientDevices([
    { id: 'srv_1', status: 'ONLINE' },
    { id: 'srv_2', status: 'OFFLINE' },
  ]);

  assert.deepEqual(items.map((item) => item.id), ['srv_1']);
});

test('buildRustDaemonStatusNote summarizes an active rust daemon runtime', () => {
  const note = buildRustDaemonStatusNote({
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'unix',
      runtime: {
        task_catalog_version: 'v0',
        supports_local_bridge_workflow: true,
      },
      catalogParity: {
        status: 'aligned',
      },
    },
  });

  assert.equal(note, 'Rust daemon ready via unix (catalog v0 · bridge ready).');
});

test('buildRustDaemonStatusNote calls out task catalog drift when parity mismatches', () => {
  const note = buildRustDaemonStatusNote({
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      runtime: {
        task_catalog_version: 'v0',
      },
      catalogParity: {
        status: 'mismatch',
        missingTaskTypes: ['bridge.submitRunNote', 'project.ensureGit'],
      },
    },
  });

  assert.equal(note, 'Rust daemon ready via http (catalog v0 · catalog drift: bridge.submitRunNote, project.ensureGit).');
});

test('buildRustDaemonStatusNote reports rust daemon probe failures', () => {
  const note = buildRustDaemonStatusNote({
    rustDaemon: {
      enabled: true,
      status: 'error',
      transport: 'http',
      error: 'connection refused',
    },
  });

  assert.equal(note, 'Rust daemon probe failed via http: connection refused.');
});

test('buildRustDaemonStatusNote also accepts dedicated rust status payloads', () => {
  const note = buildRustDaemonStatusNote({
    enabled: true,
    status: 'ok',
    transport: 'http',
    runtime: {
      task_catalog_version: 'v0',
      supports_local_bridge_workflow: true,
    },
    catalogParity: {
      status: 'aligned',
    },
  });

  assert.equal(note, 'Rust daemon ready via http (catalog v0 · bridge ready).');
});

test('buildRustDaemonStatusRows exposes runtime endpoint, task counts, and parity gaps', () => {
  const rows = buildRustDaemonStatusRows({
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'unix',
      socketPath: '/tmp/researchops-local-daemon.sock',
      taskCatalog: {
        version: 'v0',
        tasks: [
          { task_type: 'project.checkPath' },
          { task_type: 'bridge.fetchRunReport' },
        ],
      },
      catalogParity: {
        status: 'mismatch',
        missingTaskTypes: ['bridge.submitRunNote'],
        extraTaskTypes: ['bridge.extraTask'],
      },
    },
  });

  assert.deepEqual(rows, [
    { label: 'Rust Transport', value: 'unix' },
    { label: 'Rust Socket', value: '/tmp/researchops-local-daemon.sock' },
    { label: 'Rust Task Catalog', value: 'v0 (2 tasks)' },
    { label: 'Rust Catalog Parity', value: 'mismatch' },
    { label: 'Rust Missing Tasks', value: 'bridge.submitRunNote' },
    { label: 'Rust Extra Tasks', value: 'bridge.extraTask' },
  ]);
});

test('buildRustDaemonStatusRows also accepts dedicated rust status payloads', () => {
  const rows = buildRustDaemonStatusRows({
    enabled: true,
    status: 'ok',
    transport: 'http',
    endpoint: 'http://127.0.0.1:7788',
    taskCatalog: {
      version: 'v0',
      tasks: [{ task_type: 'project.checkPath' }],
    },
    catalogParity: {
      status: 'aligned',
      missingTaskTypes: [],
      extraTaskTypes: [],
    },
  });

  assert.deepEqual(rows, [
    { label: 'Rust Transport', value: 'http' },
    { label: 'Rust Endpoint', value: 'http://127.0.0.1:7788' },
    { label: 'Rust Task Catalog', value: 'v0 (1 tasks)' },
    { label: 'Rust Catalog Parity', value: 'aligned' },
  ]);
});

test('buildBootstrapRuntimeCommands returns labeled rust prototype commands', () => {
  const items = buildBootstrapRuntimeCommands({
    runtimeOptions: {
      rustDaemonPrototype: {
        commands: {
          http: 'npm run researchops:rust-daemon-serve',
          unix: 'npm run researchops:rust-daemon-serve-unix',
        },
      },
    },
  });

  assert.deepEqual(items, [
    {
      key: 'rust-http',
      label: 'Rust daemon (HTTP)',
      command: 'npm run researchops:rust-daemon-serve',
    },
    {
      key: 'rust-unix',
      label: 'Rust daemon (Unix socket)',
      command: 'npm run researchops:rust-daemon-serve-unix',
    },
  ]);
});

test('buildBootstrapRuntimeEnvFiles returns downloadable rust env files', () => {
  const items = buildBootstrapRuntimeEnvFiles({
    runtimeOptions: {
      rustDaemonPrototype: {
        envFiles: {
          http: {
            filename: '.env.researchops-rust-daemon.http',
            content: 'RESEARCHOPS_RUST_DAEMON_TRANSPORT=http',
          },
          unix: {
            filename: '.env.researchops-rust-daemon.unix',
            content: 'RESEARCHOPS_RUST_DAEMON_TRANSPORT=unix',
          },
        },
      },
    },
  });

  assert.deepEqual(items, [
    {
      key: 'rust-env-http',
      label: 'Rust env (HTTP)',
      filename: '.env.researchops-rust-daemon.http',
      content: 'RESEARCHOPS_RUST_DAEMON_TRANSPORT=http',
    },
    {
      key: 'rust-env-unix',
      label: 'Rust env (Unix socket)',
      filename: '.env.researchops-rust-daemon.unix',
      content: 'RESEARCHOPS_RUST_DAEMON_TRANSPORT=unix',
    },
  ]);
});
