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
          capabilities: {
            supportsLocalBridgeWorkflow: true,
            supportsWorkspaceSnapshotCapture: true,
          },
        },
        {
          id: 'srv_client_2',
          hostname: 'client-host-2',
          status: 'ONLINE',
          execution: { location: 'client' },
          capabilities: {
            supportsLocalBridgeWorkflow: false,
            supportsWorkspaceSnapshotCapture: false,
          },
        },
      ],
      limit: 100,
    },
    rustDaemon: {
      enabled: true,
      status: 'ok',
      transport: 'http',
      endpoint: 'http://127.0.0.1:7788',
      runtime: {
        supports_local_bridge_workflow: true,
        supports_workspace_snapshot_capture: true,
      },
      supervisor: {
        running: true,
      },
    },
    runner: {
      items: [{ runId: 'run_1' }],
    },
    refreshedAt: '2026-03-07T12:00:00.000Z',
  });

  assert.equal(payload.refreshedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(payload.daemons.items.length, 2);
  assert.equal(payload.rustDaemon.status, 'ok');
  assert.equal(payload.runner.items.length, 1);
  assert.deepEqual(payload.summary, {
    onlineClients: 2,
    bridgeReadyClients: 1,
    snapshotReadyClients: 1,
    rustBridgeReady: true,
    rustSnapshotReady: true,
    rustManagedRunning: true,
    runningCount: 1,
  });
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
