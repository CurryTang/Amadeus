'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildBridgeRunReportPayload({ report = null } = {}) {
  const source = asObject(report);
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const pendingCheckpoints = checkpoints.filter(
    (item) => cleanString(item?.status).toUpperCase() === 'PENDING'
  ).length;
  return {
    bridgeVersion: 'v0',
    runId: cleanString(source?.run?.id) || null,
    status: cleanString(source?.run?.status) || null,
    attempt: source.attempt || null,
    execution: source.execution || null,
    followUp: source.followUp || null,
    snapshots: {
      workspace: source.workspaceSnapshot || null,
      env: source.envSnapshot || null,
    },
    summary: cleanString(source.summary) || null,
    highlights: source.highlights || {},
    counts: {
      artifacts: Array.isArray(source.artifacts) ? source.artifacts.length : 0,
      checkpoints: checkpoints.length,
      pendingCheckpoints,
    },
    report: source,
  };
}

module.exports = {
  buildBridgeRunReportPayload,
};
