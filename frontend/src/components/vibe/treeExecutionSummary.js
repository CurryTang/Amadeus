import { hasManualGate } from './treeNodePresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(status = '') {
  return cleanString(status).toUpperCase() || 'PLANNED';
}

function normalizeJudgeStatus(judge = null) {
  return cleanString(judge?.status).toLowerCase();
}

function buildTreeExecutionSummary(plan = {}, treeState = {}) {
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const stateNodes = treeState?.nodes && typeof treeState.nodes === 'object' ? treeState.nodes : {};
  return nodes.reduce((summary, node) => {
    const nodeState = stateNodes[node.id] || {};
    const status = normalizeStatus(nodeState?.status);
    const judgeStatus = normalizeJudgeStatus(nodeState?.judge);
    if (status === 'RUNNING' || status === 'QUEUED') {
      summary.running += 1;
      return summary;
    }
    if (status === 'PASSED' || status === 'SUCCEEDED') {
      summary.done += 1;
      return summary;
    }
    if (status === 'FAILED') {
      summary.failed += 1;
      return summary;
    }
    if (
      status === 'BLOCKED'
      || judgeStatus === 'needs_review'
      || (hasManualGate(node) && !nodeState?.manualApproved)
    ) {
      summary.needsReview += 1;
    }
    return summary;
  }, {
    running: 0,
    needsReview: 0,
    done: 0,
    failed: 0,
  });
}

function getPrimaryTreeAction(node = {}, nodeState = {}) {
  const status = normalizeStatus(nodeState?.status);
  const judgeStatus = normalizeJudgeStatus(nodeState?.judge);
  if (hasManualGate(node) && !nodeState?.manualApproved) return 'Approve';
  if (judgeStatus === 'running') return 'Awaiting judge';
  if (judgeStatus === 'needs_review') return 'Review judge';
  if (status === 'FAILED' && cleanString(nodeState?.lastRunId)) return 'Resume';
  if (status === 'RUNNING' || status === 'QUEUED' || cleanString(nodeState?.lastRunId)) return 'View Run';
  return 'Start';
}

export {
  buildTreeExecutionSummary,
  getPrimaryTreeAction,
};
