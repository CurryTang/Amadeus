'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildHorizonCancelPayload({
  runId = '',
  session = '',
  message = '',
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    ok: true,
    runId: safeRunId || null,
    session: cleanString(session) || null,
    message: cleanString(message) || null,
    actions: safeRunId ? {
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
  buildHorizonCancelPayload,
};
