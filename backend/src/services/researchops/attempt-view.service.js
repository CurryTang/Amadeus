'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getTreeNodeId(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  return cleanString(metadata.treeNodeId || metadata.nodeId);
}

function buildAttemptViewFromRun(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  return {
    id: cleanString(run?.id),
    runId: cleanString(run?.id),
    projectId: cleanString(run?.projectId),
    nodeId: getTreeNodeId(run),
    treeNodeId: getTreeNodeId(run),
    treeNodeTitle: cleanString(metadata.treeNodeTitle),
    status: cleanString(run?.status).toUpperCase() || 'UNKNOWN',
    provider: cleanString(run?.provider),
    runType: cleanString(run?.runType),
    runSource: cleanString(metadata.runSource),
    createdAt: cleanString(run?.createdAt),
    startedAt: cleanString(run?.startedAt),
    endedAt: cleanString(run?.endedAt),
  };
}

function buildNodeAttemptSummary(run = {}) {
  const attempt = buildAttemptViewFromRun(run);
  return {
    attemptId: attempt.id,
    runId: attempt.runId,
    nodeId: attempt.nodeId,
    treeNodeTitle: attempt.treeNodeTitle,
    status: attempt.status,
    runSource: attempt.runSource,
    createdAt: attempt.createdAt,
  };
}

module.exports = {
  buildAttemptViewFromRun,
  buildNodeAttemptSummary,
};
