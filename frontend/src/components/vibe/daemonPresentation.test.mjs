import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildClientDeviceOption,
  buildBootstrapRuntimeCommands,
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
    },
  });

  assert.equal(note, 'Rust daemon ready via unix (catalog v0 · bridge ready).');
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
