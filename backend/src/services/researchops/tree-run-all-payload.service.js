'use strict';

const { buildRunPayload } = require('./run-payload.service');

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
    const runPayload = buildRunPayload({ run: result.run });
    item.attemptId = result.run.id || null;
    item.attempt = runPayload.attempt;
    item.execution = runPayload.execution;
    item.followUp = runPayload.followUp;
    item.contract = runPayload.contract;
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
