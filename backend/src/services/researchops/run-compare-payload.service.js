'use strict';

const { buildRunPayload } = require('./run-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function summarizeReport(report = {}) {
  const normalized = asObject(report);
  const checkpoints = Array.isArray(normalized.checkpoints) ? normalized.checkpoints : [];
  return {
    summary: cleanString(normalized.summary) || null,
    highlights: asObject(normalized.highlights),
    observability: normalized.observability || null,
    workspaceSnapshot: normalized.workspaceSnapshot || null,
    envSnapshot: normalized.envSnapshot || null,
    checkpointStatuses: checkpoints
      .map((item) => cleanString(item?.status).toLowerCase())
      .filter(Boolean),
  };
}

function buildRunActions(runId = '') {
  const safeRunId = cleanString(runId);
  if (!safeRunId) return {};
  return {
    report: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/report`,
    },
    artifacts: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/artifacts`,
    },
    bridgeReport: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/bridge-report`,
    },
  };
}

function asCompareItem(run = null, report = null) {
  const normalizedRunId = cleanString(run?.id);
  return {
    ...buildRunPayload({ run }),
    report: summarizeReport(report),
    actions: buildRunActions(normalizedRunId),
  };
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => cleanString(item)).filter(Boolean))];
}

function buildRunComparePayload({
  run = null,
  otherRun = null,
  report = null,
  otherReport = null,
  requestedOtherRunId = null,
} = {}) {
  const base = asCompareItem(run, report);
  const other = asCompareItem(otherRun, otherReport);
  const baseNodeId = cleanString(base.attempt?.treeNodeId);
  const otherNodeId = cleanString(other.attempt?.treeNodeId);
  const baseParentIds = uniqueStrings([
    base.followUp?.parentRunId,
    base.followUp?.continuationOfRunId,
  ]);
  const otherParentIds = uniqueStrings([
    other.followUp?.parentRunId,
    other.followUp?.continuationOfRunId,
  ]);
  const sharedParentRunIds = baseParentIds.filter((item) => otherParentIds.includes(item));
  const relatedRunIds = uniqueStrings([
    ...(Array.isArray(base.followUp?.relatedRunIds) ? base.followUp.relatedRunIds : []),
    ...(Array.isArray(other.followUp?.relatedRunIds) ? other.followUp.relatedRunIds : []),
  ]);
  const requestedId = cleanString(requestedOtherRunId);
  const baseRunId = cleanString(run?.id);

  return {
    run,
    attempt: base.attempt,
    execution: base.execution,
    followUp: base.followUp,
    report: base.report,
    actions: {
      ...buildRunActions(baseRunId),
      ...(baseRunId && requestedId ? {
        compare: {
          method: 'GET',
          path: `/researchops/runs/${baseRunId}/compare?otherRunId=${requestedId}`,
        },
      } : {}),
    },
    other,
    relation: {
      requestedOtherRunId: requestedId || null,
      sameProject: cleanString(run?.projectId) !== '' && cleanString(run?.projectId) === cleanString(otherRun?.projectId),
      sameNode: Boolean(baseNodeId && baseNodeId === otherNodeId),
      sharedTreeNodeId: baseNodeId && baseNodeId === otherNodeId ? baseNodeId : null,
      sharedParentRunIds,
      relatedRunIds,
    },
  };
}

module.exports = {
  buildRunComparePayload,
};
