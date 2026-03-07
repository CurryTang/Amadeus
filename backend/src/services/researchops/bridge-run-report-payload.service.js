'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildBridgeReportActions(runId = '') {
  const safeRunId = cleanString(runId);
  if (!safeRunId) return {};
  return {
    contextPack: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/context-pack`,
    },
    report: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/report`,
    },
    artifacts: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/artifacts`,
    },
    bridgeNote: {
      method: 'POST',
      path: `/researchops/runs/${safeRunId}/bridge-note`,
    },
  };
}

function buildBridgeRunReportPayload({ report = null } = {}) {
  const source = asObject(report);
  const runId = cleanString(source?.run?.id);
  const checkpoints = Array.isArray(source.checkpoints) ? source.checkpoints : [];
  const highlights = asObject(source.highlights);
  const deliverableArtifactIds = Array.isArray(highlights.deliverableArtifactIds)
    ? highlights.deliverableArtifactIds.filter((item) => cleanString(item))
    : [];
  const pendingCheckpoints = checkpoints.filter(
    (item) => cleanString(item?.status).toUpperCase() === 'PENDING'
  ).length;
  return {
    bridgeVersion: 'v0',
    runId: runId || null,
    status: cleanString(source?.run?.status) || null,
    attempt: source.attempt || null,
    execution: source.execution || null,
    followUp: source.followUp || null,
    contract: source.contract || null,
    snapshots: {
      workspace: source.workspaceSnapshot || null,
      env: source.envSnapshot || null,
    },
    summary: cleanString(source.summary) || null,
    highlights,
    counts: {
      artifacts: Array.isArray(source.artifacts) ? source.artifacts.length : 0,
      deliverables: deliverableArtifactIds.length,
      checkpoints: checkpoints.length,
      pendingCheckpoints,
    },
    flags: {
      hasSummary: Boolean(highlights.summaryArtifactId || cleanString(source.summary)),
      hasFinalOutput: Boolean(highlights.finalOutputArtifactId),
      hasContractFailures: source?.contract?.ok === false,
    },
    actions: buildBridgeReportActions(runId),
    report: source,
  };
}

module.exports = {
  buildBridgeRunReportPayload,
};
