'use strict';

function normalizeItem(item = null) {
  return item && typeof item === 'object' && !Array.isArray(item) ? item : {};
}

function buildRunnerRunningPayload({
  items = [],
} = {}) {
  return {
    items: (Array.isArray(items) ? items : []).map((item) => normalizeItem(item)),
    actions: {
      running: {
        method: 'GET',
        path: '/researchops/runner/running',
      },
      dispatcherStatus: {
        method: 'GET',
        path: '/researchops/scheduler/dispatcher/status',
      },
    },
  };
}

function buildAgentCapacityPayload({
  totals = null,
  providers = [],
  refreshedAt = '',
} = {}) {
  return {
    totals: normalizeItem(totals),
    providers: (Array.isArray(providers) ? providers : []).map((item) => normalizeItem(item)),
    refreshedAt: typeof refreshedAt === 'string' ? refreshedAt.trim() || null : null,
    actions: {
      agentCapacity: {
        method: 'GET',
        path: '/researchops/cluster/agent-capacity',
      },
      running: {
        method: 'GET',
        path: '/researchops/runner/running',
      },
    },
  };
}

module.exports = {
  buildRunnerRunningPayload,
  buildAgentCapacityPayload,
};
