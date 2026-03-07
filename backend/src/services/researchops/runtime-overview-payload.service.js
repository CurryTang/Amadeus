'use strict';

function buildRuntimeOverviewSummary({ daemons = null, rustDaemon = null, runner = null } = {}) {
  const daemonItems = Array.isArray(daemons?.items) ? daemons.items : [];
  const onlineClients = daemonItems.filter((item) => String(item?.status || '').trim().toUpperCase() === 'ONLINE').length;
  const bridgeReadyClients = daemonItems.filter((item) => item?.capabilities?.supportsLocalBridgeWorkflow === true).length;
  const snapshotReadyClients = daemonItems.filter((item) => item?.capabilities?.supportsWorkspaceSnapshotCapture === true).length;
  const runningCount = Array.isArray(runner?.items) ? runner.items.length : 0;
  return {
    onlineClients,
    bridgeReadyClients,
    snapshotReadyClients,
    rustBridgeReady: rustDaemon?.runtime?.supports_local_bridge_workflow === true,
    rustSnapshotReady: rustDaemon?.runtime?.supports_workspace_snapshot_capture === true,
    rustManagedRunning: rustDaemon?.supervisor?.running === true,
    runningCount,
  };
}

function buildRuntimeOverviewPayload({
  daemons = null,
  rustDaemon = null,
  runner = null,
  refreshedAt = '',
} = {}) {
  return {
    refreshedAt: String(refreshedAt || '').trim() || new Date().toISOString(),
    daemons: daemons && typeof daemons === 'object'
      ? {
          ...daemons,
          items: Array.isArray(daemons.items) ? daemons.items.map((item) => ({ ...item })) : [],
        }
      : {
          items: [],
          limit: null,
        },
    rustDaemon: rustDaemon && typeof rustDaemon === 'object' ? { ...rustDaemon } : null,
    runner: runner && typeof runner === 'object'
      ? {
          ...runner,
          items: Array.isArray(runner.items) ? runner.items.map((item) => ({ ...item })) : [],
        }
      : {
          items: [],
        },
    summary: buildRuntimeOverviewSummary({ daemons, rustDaemon, runner }),
    actions: {
      overview: {
        method: 'GET',
        path: '/researchops/runtime/overview',
      },
      daemons: {
        method: 'GET',
        path: '/researchops/daemons',
      },
      rustDaemonStatus: {
        method: 'GET',
        path: '/researchops/daemons/rust/status',
      },
      runnerRunning: {
        method: 'GET',
        path: '/researchops/runner/running',
      },
    },
  };
}

module.exports = {
  buildRuntimeOverviewSummary,
  buildRuntimeOverviewPayload,
};
