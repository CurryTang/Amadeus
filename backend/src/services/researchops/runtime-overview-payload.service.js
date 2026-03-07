'use strict';

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
  buildRuntimeOverviewPayload,
};
