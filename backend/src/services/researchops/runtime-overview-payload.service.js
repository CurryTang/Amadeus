'use strict';

const {
  buildExecutionRuntimeCatalog,
  buildRecommendedExecutionRuntime,
} = require('./runtime-catalog.service');

function buildRuntimeOverviewSummary({ daemons = null, rustDaemon = null, runner = null } = {}) {
  const runtimeCatalog = buildExecutionRuntimeCatalog();
  const daemonItems = Array.isArray(daemons?.items) ? daemons.items : [];
  const onlineClients = daemonItems.filter((item) => String(item?.status || '').trim().toUpperCase() === 'ONLINE').length;
  const bridgeReadyClients = daemonItems.filter((item) => item?.capabilities?.supportsLocalBridgeWorkflow === true).length;
  const snapshotReadyClients = daemonItems.filter((item) => item?.capabilities?.supportsWorkspaceSnapshotCapture === true).length;
  const runningCount = Array.isArray(runner?.items) ? runner.items.length : 0;
  const summary = {
    onlineClients,
    bridgeReadyClients,
    snapshotReadyClients,
    rustBridgeReady: rustDaemon?.runtime?.supports_local_bridge_workflow === true,
    rustSnapshotReady: rustDaemon?.runtime?.supports_workspace_snapshot_capture === true,
    rustManagedRunning: rustDaemon?.supervisor?.running === true,
    rustManagedDesired: rustDaemon?.supervisor?.desiredState === 'running',
    runningCount,
    runtimeCatalogVersion: runtimeCatalog.version,
    backendCount: runtimeCatalog.backends.length,
    runtimeClassCount: runtimeCatalog.runtimeClasses.length,
  };
  const recommendation = buildRecommendedExecutionRuntime({ runtimeSummary: summary });
  return {
    ...summary,
    recommendedBackend: recommendation.backend,
    recommendedRuntimeClass: recommendation.runtimeClass,
    recommendationReason: recommendation.reason,
  };
}

function buildRuntimeOverviewPayload({
  daemons = null,
  rustDaemon = null,
  runner = null,
  refreshedAt = '',
} = {}) {
  const runtimeCatalog = buildExecutionRuntimeCatalog();
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
    runtimeCatalog,
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
      runtimeCatalog: {
        method: 'GET',
        path: '/researchops/runtime/catalog',
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
