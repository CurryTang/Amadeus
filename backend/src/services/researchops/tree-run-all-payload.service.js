'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');

function buildQueuedTreeRunAllItem({
  nodeId = '',
  result = {},
} = {}) {
  const item = {
    nodeId,
    mode: result?.mode || '',
    runId: result?.run?.id || null,
  };
  if (result?.run && typeof result.run === 'object') {
    item.attemptId = result.run.id || null;
    item.attempt = buildAttemptViewFromRun(result.run);
  }
  return item;
}

function buildTreeRunAllPayload({
  projectId = '',
  scope = '',
  fromNodeId = '',
  queued = [],
  blocked = [],
  summary = {},
} = {}) {
  return {
    projectId,
    scope,
    fromNodeId: fromNodeId || null,
    queued: Array.isArray(queued) ? queued : [],
    blocked: Array.isArray(blocked) ? blocked : [],
    summary: summary && typeof summary === 'object' ? summary : {},
  };
}

module.exports = {
  buildQueuedTreeRunAllItem,
  buildTreeRunAllPayload,
};
