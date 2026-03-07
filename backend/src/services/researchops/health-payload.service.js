'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildResearchOpsHealthPayload({
  status = 'ok',
  storeMode = '',
  running = 0,
  timestamp = '',
  rustDaemon = null,
} = {}) {
  const numericRunning = Number(running);
  return {
    status: cleanString(status) || 'ok',
    storeMode: cleanString(storeMode) || null,
    running: Number.isFinite(numericRunning) ? numericRunning : 0,
    timestamp: cleanString(timestamp) || new Date().toISOString(),
    rustDaemon: rustDaemon && typeof rustDaemon === 'object'
      ? {
          enabled: rustDaemon.enabled === true,
          status: cleanString(rustDaemon.status) || 'unknown',
          transport: cleanString(rustDaemon.transport) || null,
          endpoint: cleanString(rustDaemon.endpoint) || null,
          socketPath: cleanString(rustDaemon.socketPath) || null,
          runtime: rustDaemon.runtime && typeof rustDaemon.runtime === 'object'
            ? { ...rustDaemon.runtime }
            : null,
          taskCatalog: rustDaemon.taskCatalog && typeof rustDaemon.taskCatalog === 'object'
            ? {
                ...rustDaemon.taskCatalog,
                tasks: Array.isArray(rustDaemon.taskCatalog.tasks)
                  ? rustDaemon.taskCatalog.tasks.map((item) => ({ ...item }))
                  : [],
              }
            : null,
          catalogParity: rustDaemon.catalogParity && typeof rustDaemon.catalogParity === 'object'
            ? {
                status: cleanString(rustDaemon.catalogParity.status) || 'unknown',
                expectedVersion: cleanString(rustDaemon.catalogParity.expectedVersion) || null,
                actualVersion: cleanString(rustDaemon.catalogParity.actualVersion) || null,
                missingTaskTypes: Array.isArray(rustDaemon.catalogParity.missingTaskTypes)
                  ? rustDaemon.catalogParity.missingTaskTypes.map((item) => cleanString(item)).filter(Boolean)
                  : [],
                extraTaskTypes: Array.isArray(rustDaemon.catalogParity.extraTaskTypes)
                  ? rustDaemon.catalogParity.extraTaskTypes.map((item) => cleanString(item)).filter(Boolean)
                  : [],
              }
            : null,
          error: cleanString(rustDaemon.error) || null,
        }
      : null,
    actions: {
      health: {
        method: 'GET',
        path: '/api/researchops/health',
      },
    },
  };
}

module.exports = {
  buildResearchOpsHealthPayload,
};
