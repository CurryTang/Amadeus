'use strict';

const { buildBridgeDaemonTaskActions } = require('./bridge-daemon-task-action.service');
const { buildBridgeRuntimeView } = require('./bridge-runtime-view.service');

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

function buildBridgeReportSubmitHints() {
  return {
    bridgeReport: {
      query: {
        transport: '"http"|"daemon-task"',
      },
    },
  };
}

function buildBridgeRunReportPayload({ report = null, bridgeRuntime = null } = {}) {
  const source = asObject(report);
  const normalizedBridgeRuntime = buildBridgeRuntimeView(bridgeRuntime);
  const runId = cleanString(source?.run?.id);
  const projectId = cleanString(source?.run?.projectId);
  const nodeId = cleanString(source?.attempt?.treeNodeId);
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
    bridgeRuntime: normalizedBridgeRuntime && Object.keys(normalizedBridgeRuntime).length > 0 ? normalizedBridgeRuntime : null,
    actions: buildBridgeReportActions(runId),
    submitHints: buildBridgeReportSubmitHints(),
    taskActions: buildBridgeDaemonTaskActions({
      serverId: normalizedBridgeRuntime?.serverId,
      projectId,
      nodeId,
      runId,
    }),
    report: source,
  };
}

module.exports = {
  buildBridgeRunReportPayload,
};
