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
