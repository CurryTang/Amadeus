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
  const normalizedBridgeReport = asObject(bridgeReport);
  const bridgeSnapshots = asObject(normalizedBridgeReport.snapshots);
  const workspaceSnapshot = asObject(bridgeSnapshots.workspace);
  const envSnapshot = asObject(bridgeSnapshots.env);
  const localSnapshot = asObject(workspaceSnapshot.localSnapshot);
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
    bridgeReport: normalizedBridgeReport && Object.keys(normalizedBridgeReport).length > 0 ? normalizedBridgeReport : null,
    capabilities: {
      hasLastRun: Boolean(lastRun?.run?.id),
      hasContextPack: Boolean(normalizedContextPack?.view || normalizedContextPack?.pack || normalizedContextPack?.mode),
      hasBridgeReport: Boolean(normalizedBridgeReport?.runId),
      hasWorkspaceSnapshot: Boolean(workspaceSnapshot.path || workspaceSnapshot.runSpecArtifactId || workspaceSnapshot.sourceServerId),
      hasLocalSnapshot: Boolean(localSnapshot.kind || localSnapshot.note),
      hasEnvSnapshot: Boolean(envSnapshot.backend || envSnapshot.runtimeClass || envSnapshot.resources),
      canRun: true,
    },
  };
}

module.exports = {
  buildNodeBridgeContextPayload,
};
