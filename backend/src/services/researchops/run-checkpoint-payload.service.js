'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildCheckpointActions(runId = '', checkpointId = '') {
  const safeRunId = cleanString(runId);
  const safeCheckpointId = cleanString(checkpointId);
  if (!safeRunId || !safeCheckpointId) return {};
  return {
    decide: {
      method: 'POST',
      path: `/researchops/runs/${encodeURIComponent(safeRunId)}/checkpoints/${encodeURIComponent(safeCheckpointId)}/decision`,
    },
  };
}

function normalizeCheckpoint(runId = '', checkpoint = null) {
  const source = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
  const checkpointId = cleanString(source.id);
  return {
    ...source,
    id: checkpointId || null,
    runId: cleanString(source.runId) || cleanString(runId) || null,
    status: cleanString(source.status).toUpperCase() || null,
    message: cleanString(source.message) || null,
    decision: source.decision && typeof source.decision === 'object'
      ? {
        ...source.decision,
        action: cleanString(source.decision.action).toUpperCase() || null,
        decision: cleanString(source.decision.decision).toUpperCase() || null,
      }
      : null,
    payload: asObject(source.payload),
    requestedActions: Array.isArray(source.requestedActions) ? source.requestedActions : [],
    actions: buildCheckpointActions(runId, checkpointId),
  };
}

function buildRunCheckpointListPayload({
  runId = '',
  status = '',
  items = [],
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    runId: safeRunId || null,
    filters: {
      status: cleanString(status) || null,
    },
    items: (Array.isArray(items) ? items : []).map((item) => normalizeCheckpoint(safeRunId, item)),
  };
}

function buildRunCheckpointDecisionPayload({
  runId = '',
  checkpoint = null,
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    runId: safeRunId || null,
    checkpoint: normalizeCheckpoint(safeRunId, checkpoint),
    actions: safeRunId ? {
      list: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}/checkpoints`,
      },
    } : {},
  };
}

module.exports = {
  buildRunCheckpointDecisionPayload,
  buildRunCheckpointListPayload,
};
