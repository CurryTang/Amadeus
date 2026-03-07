'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildResearchOpsHealthPayload({
  status = 'ok',
  storeMode = '',
  running = 0,
  timestamp = '',
} = {}) {
  const numericRunning = Number(running);
  return {
    status: cleanString(status) || 'ok',
    storeMode: cleanString(storeMode) || null,
    running: Number.isFinite(numericRunning) ? numericRunning : 0,
    timestamp: cleanString(timestamp) || new Date().toISOString(),
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
