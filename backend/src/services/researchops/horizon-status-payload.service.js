'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildHorizonStatusPayload({
  runId = '',
  status = '',
  message = '',
  lastCheck = null,
  nextCheck = null,
  wakeups = 0,
  tmuxAlive = null,
  recentLog = '',
  session = '',
  serverId = '',
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    runId: safeRunId || null,
    status: cleanString(status) || 'unknown',
    message: cleanString(message) || '',
    lastCheck: lastCheck || null,
    nextCheck: nextCheck || null,
    wakeups: Number.isFinite(Number(wakeups)) ? Number(wakeups) : 0,
    tmuxAlive: tmuxAlive === null || tmuxAlive === undefined ? null : Boolean(tmuxAlive),
    recentLog: typeof recentLog === 'string' ? recentLog : '',
    session: cleanString(session) || null,
    serverId: cleanString(serverId) || null,
    actions: safeRunId ? {
      status: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}/horizon-status`,
      },
      cancel: {
        method: 'POST',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}/horizon-cancel`,
      },
      runDetail: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}`,
      },
    } : {},
  };
}

module.exports = {
  buildHorizonStatusPayload,
};
