import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBootstrapRuntimeCommands,
  buildBootstrapRuntimeCommandGroups,
  buildBootstrapRuntimeEnvFiles,
  buildRustDaemonActionItems,
  buildClientDeviceOption,
  buildRuntimeOverviewPanelRows,
  buildRustDaemonStatusRows,
  buildRustDaemonStatusNote,
  buildRuntimeOverviewSummaryRows,
  buildUnifiedControlSurfaceRows,
  filterOnlineClientDevices,
  getRuntimeOverviewClientDevices,
  getRuntimeOverviewRustStatus,
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
      supportsWorkspaceSnapshotCapture: true,
    },
  });

  assert.deepEqual(option, {
    value: 'srv_1',
    label: 'client-host (ONLINE · client · bridge ready · snapshot ready)',
  });
});

test('filterOnlineClientDevices keeps online devices only', () => {
  const items = filterOnlineClientDevices([
    { id: 'srv_1', status: 'ONLINE' },
    { id: 'srv_2', status: 'OFFLINE' },
  ]);

  assert.deepEqual(items.map((item) => item.id), ['srv_1']);
});

test('runtime overview helpers extract daemon items and rust status from aggregate payloads', () => {
  const overview = {
    daemons: {
      items: [{ id: 'srv_1', status: 'ONLINE' }],
    },
    rustDaemon: {
      enabled: true,
      status: 'ok',
    },
  };

  assert.deepEqual(getRuntimeOverviewClientDevices(overview), [{ id: 'srv_1', status: 'ONLINE' }]);
  assert.deepEqual(getRuntimeOverviewRustStatus(overview), { enabled: true, status: 'ok' });
});

test('buildRustDaemonActionItems exposes lifecycle actions from rust status payload', () => {
  const items = buildRustDaemonActionItems({
    enabled: true,
    actions: {
      start: { method: 'POST', path: '/researchops/daemons/rust/start' },
      stop: { method: 'POST', path: '/researchops/daemons/rust/stop' },
      restart: { method: 'POST', path: '/researchops/daemons/rust/restart' },
      enableManaged: { method: 'POST', path: '/researchops/daemons/rust/enable-managed' },
      disableManaged: { method: 'POST', path: '/researchops/daemons/rust/disable-managed' },
      reconcileManaged: { method: 'POST', path: '/researchops/daemons/rust/reconcile' },
    },
  });

  assert.deepEqual(items, [
    {
      key: 'start',
      label: 'Start Rust Daemon',
      path: '/researchops/daemons/rust/start',
      method: 'POST',
      disabled: false,
    },
    {
      key: 'stop',
      label: 'Stop Rust Daemon',
      path: '/researchops/daemons/rust/stop',
      method: 'POST',
      disabled: false,
    },
    {
      key: 'restart',
      label: 'Restart Rust Daemon',
      path: '/researchops/daemons/rust/restart',
      method: 'POST',
      disabled: false,
    },
    {
      key: 'enable-managed',
      label: 'Enable Managed Mode',
      path: '/researchops/daemons/rust/enable-managed',
      method: 'POST',
      disabled: false,
    },
    {
      key: 'disable-managed',
      label: 'Disable Managed Mode',
      path: '/researchops/daemons/rust/disable-managed',
      method: 'POST',
      disabled: false,
    },
    {
      key: 'reconcile-managed',
      label: 'Reconcile Managed State',
      path: '/researchops/daemons/rust/reconcile',
      method: 'POST',
      disabled: false,
    },
  ]);
});


test('buildRuntimeOverviewSummaryRows exposes client and rust readiness counts', () => {
  const rows = buildRuntimeOverviewSummaryRows({
    onlineClients: 2,
    bridgeReadyClients: 1,
    snapshotReadyClients: 1,
    rustBridgeReady: true,
    rustSnapshotReady: true,
    rustManagedRunning: false,
    rustManagedDesired: true,
    recommendedBackend: 'container',
    recommendedRuntimeClass: 'container-guarded',
    runningCount: 3,
    runtimeCatalogVersion: 'v0',
    backendCount: 4,
    runtimeClassCount: 4,
  });

  assert.deepEqual(rows, [
    { label: 'Online Clients', value: '2' },
    { label: 'Bridge-Ready Clients', value: '1' },
    { label: 'Snapshot-Ready Clients', value: '1' },
    { label: 'Rust Bridge Ready', value: 'yes' },
    { label: 'Rust Snapshot Ready', value: 'yes' },
    { label: 'Rust Managed', value: 'no' },
    { label: 'Rust Desired', value: 'running' },
    { label: 'Recommended Runtime', value: 'container / container-guarded' },
    { label: 'Running Jobs', value: '3' },
    { label: 'Runtime Catalog', value: 'v0 · 4 backends · 4 runtime classes' },
  ]);
});

test('buildRuntimeOverviewPanelRows preserves summary-only rows when rust status is absent', () => {
  const rows = buildRuntimeOverviewPanelRows({
    runtimeOverviewSummary: {
      onlineClients: 2,
      bridgeReadyClients: 1,
      snapshotReadyClients: 1,
      rustBridgeReady: false,
      rustSnapshotReady: false,
      rustManagedRunning: false,
      rustManagedDesired: true,
      recommendedBackend: 'container',
      recommendedRuntimeClass: 'container-guarded',
      recommendationReason: 'Managed Rust bridge runtime is online for guarded execution.',
      runningCount: 3,
      runtimeCatalogVersion: 'v0',
      backendCount: 4,
      runtimeClassCount: 4,
    },
    rustDaemonStatus: null,
  });

  assert.deepEqual(rows, [
    { label: 'Online Clients', value: '2' },
    { label: 'Bridge-Ready Clients', value: '1' },
    { label: 'Snapshot-Ready Clients', value: '1' },
    { label: 'Rust Bridge Ready', value: 'no' },
    { label: 'Rust Snapshot Ready', value: 'no' },
    { label: 'Rust Managed', value: 'no' },
    { label: 'Rust Desired', value: 'running' },
    { label: 'Recommended Runtime', value: 'container / container-guarded' },
    { label: 'Running Jobs', value: '3' },
    { label: 'Runtime Catalog', value: 'v0 · 4 backends · 4 runtime classes' },
  ]);
});

test('buildUnifiedControlSurfaceRows combines review and runtime signals', () => {
  const rows = buildUnifiedControlSurfaceRows({
    reviewSummary: {
      status: 'needs_attention',
      attentionCount: 2,
      remoteExecutionCount: 3,
      snapshotBackedCount: 1,
      instrumentedCount: 2,
      instrumentedProviders: ['tensorboard', 'wandb'],
      resolvedTransports: ['daemon-task', 'rust-daemon'],
    },
    runtimeSummary: {
      onlineClients: 2,
      bridgeReadyClients: 1,
      snapshotReadyClients: 1,
      rustManagedRunning: false,
      rustManagedDesired: true,
      recommendedBackend: 'container',
      recommendedRuntimeClass: 'container-guarded',
      runningCount: 4,
    },
  });

  assert.deepEqual(rows, [
    { label: 'Control Status', value: 'needs attention' },
    { label: 'Attention Runs', value: '2' },
    { label: 'Runtime Drift', value: 'managed desired, runtime down' },
    { label: 'Recommended Runtime', value: 'container / container-guarded' },
    { label: 'Remote Runs', value: '3' },
    { label: 'Snapshot-Backed Runs', value: '1' },
    { label: 'Instrumented Runs', value: '2' },
    { label: 'Telemetry', value: 'tensorboard, wandb' },
    { label: 'Transports', value: 'daemon-task, rust-daemon' },
    { label: 'Client Coverage', value: '1/2 bridge-ready · 1/2 snapshot-ready' },
    { label: 'Running Jobs', value: '4' },
  ]);
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
        supports_workspace_snapshot_capture: true,
      },
      catalogParity: {
        status: 'aligned',
      },
    },
  });

  assert.equal(note, 'Rust daemon ready via unix (catalog v0 · bridge ready · snapshot ready).');
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
      supports_workspace_snapshot_capture: true,
    },
    catalogParity: {
      status: 'aligned',
    },
  });

  assert.equal(note, 'Rust daemon ready via http (catalog v0 · bridge ready · snapshot ready).');
});

test('buildRustDaemonStatusRows exposes runtime endpoint, task counts, and parity gaps', () => {
  const rows = buildRustDaemonStatusRows({
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'unix',
      socketPath: '/tmp/researchops-local-daemon.sock',
      runtime: {
        supports_workspace_snapshot_capture: true,
      },
      supervisor: {
        running: true,
        desiredState: 'running',
        pid: 43210,
        pidFile: '/tmp/researchops-rust-daemon/rust-daemon.pid',
        logFile: '/tmp/researchops-rust-daemon/rust-daemon.log',
      },
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
    { label: 'Rust Managed', value: 'yes' },
    { label: 'Rust Desired', value: 'running' },
    { label: 'Rust PID', value: '43210' },
    { label: 'Rust PID File', value: '/tmp/researchops-rust-daemon/rust-daemon.pid' },
    { label: 'Rust Log', value: '/tmp/researchops-rust-daemon/rust-daemon.log' },
    { label: 'Rust Snapshot Capture', value: 'ready' },
    { label: 'Rust Catalog Parity', value: 'mismatch' },
    { label: 'Rust Missing Tasks', value: 'bridge.submitRunNote' },
    { label: 'Rust Extra Tasks', value: 'bridge.extraTask' },
  ]);
});

test('buildRustDaemonStatusRows also accepts dedicated rust status payloads', () => {
  const rows = buildRustDaemonStatusRows({
    enabled: true,
    status: 'ok',
    refreshedAt: '2026-03-07T12:00:00.000Z',
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
    { label: 'Rust Checked', value: '2026-03-07T12:00:00.000Z' },
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
          launcher: 'npm run researchops:rust-daemon',
          background: 'nohup npm run researchops:rust-daemon >/tmp/rust.log 2>&1 &',
          http: 'npm run researchops:rust-daemon-serve',
          unix: 'npm run researchops:rust-daemon-serve-unix',
          verify: 'npm run researchops:verify-rust-daemon-prototype',
        },
      },
    },
  });

  assert.deepEqual(items, [
    {
      key: 'rust-launcher',
      label: 'Rust daemon (Launcher)',
      command: 'npm run researchops:rust-daemon',
    },
    {
      key: 'rust-background',
      label: 'Rust daemon (Managed background)',
      command: 'nohup npm run researchops:rust-daemon >/tmp/rust.log 2>&1 &',
    },
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
    {
      key: 'rust-verify',
      label: 'Rust daemon (Verify)',
      command: 'npm run researchops:verify-rust-daemon-prototype',
    },
  ]);
});

test('buildBootstrapRuntimeCommands also accepts dedicated rust status payloads', () => {
  const items = buildBootstrapRuntimeCommands({
    runtimeOptions: {
      rustDaemonPrototype: {
        commands: {
          http: 'sh /tmp/researchops-bootstrap-rust-daemon.sh',
        },
      },
    },
  });

  assert.deepEqual(items, [
    {
      key: 'rust-http',
      label: 'Rust daemon (HTTP)',
      command: 'sh /tmp/researchops-bootstrap-rust-daemon.sh',
    },
  ]);
});

test('buildBootstrapRuntimeCommands also exposes debug probe commands from rust status payloads', () => {
  const items = buildBootstrapRuntimeCommands({
    debugCommands: {
      health: 'curl http://127.0.0.1:7788/health',
      runtime: 'curl http://127.0.0.1:7788/runtime',
      taskCatalog: 'curl http://127.0.0.1:7788/task-catalog',
      snapshotCapture: `curl -X POST http://127.0.0.1:7788/tasks/execute -H 'Content-Type: application/json' -d '{"taskType":"bridge.captureWorkspaceSnapshot","payload":{"workspacePath":"./frontend","kind":"workspace_patch","note":"local edits"}}'`,
    },
  });

  assert.deepEqual(items, [
    {
      key: 'rust-debug-health',
      label: 'Rust debug (Health)',
      command: 'curl http://127.0.0.1:7788/health',
    },
    {
      key: 'rust-debug-runtime',
      label: 'Rust debug (Runtime)',
      command: 'curl http://127.0.0.1:7788/runtime',
    },
    {
      key: 'rust-debug-task-catalog',
      label: 'Rust debug (Task Catalog)',
      command: 'curl http://127.0.0.1:7788/task-catalog',
    },
    {
      key: 'rust-debug-snapshot-capture',
      label: 'Rust debug (Snapshot Capture)',
      command: `curl -X POST http://127.0.0.1:7788/tasks/execute -H 'Content-Type: application/json' -d '{"taskType":"bridge.captureWorkspaceSnapshot","payload":{"workspacePath":"./frontend","kind":"workspace_patch","note":"local edits"}}'`,
    },
  ]);
});

test('buildBootstrapRuntimeCommandGroups groups launcher, verify, serve, and debug commands', () => {
  const groups = buildBootstrapRuntimeCommandGroups([
    { key: 'rust-launcher', label: 'Rust daemon (Launcher)', command: 'npm run researchops:rust-daemon' },
    { key: 'rust-background', label: 'Rust daemon (Managed background)', command: 'nohup npm run researchops:rust-daemon >/tmp/rust.log 2>&1 &' },
    { key: 'rust-verify', label: 'Rust daemon (Verify)', command: 'npm run researchops:verify-rust-daemon-prototype' },
    { key: 'rust-http', label: 'Rust daemon (HTTP)', command: 'npm run researchops:rust-daemon-serve' },
    { key: 'rust-unix', label: 'Rust daemon (Unix socket)', command: 'npm run researchops:rust-daemon-serve-unix' },
    { key: 'rust-debug-health', label: 'Rust debug (Health)', command: 'curl http://127.0.0.1:7788/health' },
  ]);

  assert.deepEqual(groups, [
    {
      key: 'operate',
      title: 'Operate',
      items: [
        { key: 'rust-launcher', label: 'Rust daemon (Launcher)', command: 'npm run researchops:rust-daemon' },
        { key: 'rust-background', label: 'Rust daemon (Managed background)', command: 'nohup npm run researchops:rust-daemon >/tmp/rust.log 2>&1 &' },
      ],
    },
    {
      key: 'serve',
      title: 'Serve',
      items: [
        { key: 'rust-http', label: 'Rust daemon (HTTP)', command: 'npm run researchops:rust-daemon-serve' },
        { key: 'rust-unix', label: 'Rust daemon (Unix socket)', command: 'npm run researchops:rust-daemon-serve-unix' },
      ],
    },
    {
      key: 'verify',
      title: 'Verify',
      items: [
        { key: 'rust-verify', label: 'Rust daemon (Verify)', command: 'npm run researchops:verify-rust-daemon-prototype' },
      ],
    },
    {
      key: 'debug',
      title: 'Debug',
      items: [
        { key: 'rust-debug-health', label: 'Rust debug (Health)', command: 'curl http://127.0.0.1:7788/health' },
      ],
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

test('buildBootstrapRuntimeEnvFiles also accepts dedicated rust status payloads', () => {
  const items = buildBootstrapRuntimeEnvFiles({
    runtimeOptions: {
      rustDaemonPrototype: {
        envFiles: {
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
      key: 'rust-env-unix',
      label: 'Rust env (Unix socket)',
      filename: '.env.researchops-rust-daemon.unix',
      content: 'RESEARCHOPS_RUST_DAEMON_TRANSPORT=unix',
    },
  ]);
});
