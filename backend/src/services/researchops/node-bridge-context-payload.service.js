'use strict';

const { buildRunPayload } = require('./run-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildNodeBridgeContextPayload({
  projectId = '',
  node = null,
  nodeState = null,
  blocking = null,
  run = null,
  contextPack = null,
  bridgeReport = null,
} = {}) {
  const normalizedNode = asObject(node);
  const normalizedState = asObject(nodeState);
  const normalizedBlocking = asObject(blocking);
  const normalizedContextPack = asObject(contextPack);
  const lastRun = run ? buildRunPayload({ run }) : null;
  return {
    bridgeVersion: 'v0',
    projectId: cleanString(projectId) || null,
    nodeId: cleanString(normalizedNode.id) || null,
    node: node || null,
    nodeState: nodeState || null,
    blocking: {
      blocked: Boolean(normalizedBlocking.blocked),
      blockedBy: Array.isArray(normalizedBlocking.blockedBy) ? normalizedBlocking.blockedBy : [],
    },
    lastRun,
    contextPack: normalizedContextPack && Object.keys(normalizedContextPack).length > 0 ? normalizedContextPack : null,
    bridgeReport: bridgeReport && typeof bridgeReport === 'object' ? bridgeReport : null,
    capabilities: {
      hasLastRun: Boolean(lastRun?.run?.id),
      hasContextPack: Boolean(normalizedContextPack?.view || normalizedContextPack?.pack || normalizedContextPack?.mode),
      hasBridgeReport: Boolean(bridgeReport?.runId),
      canRun: true,
    },
  };
}

module.exports = {
  buildNodeBridgeContextPayload,
};
