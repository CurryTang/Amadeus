'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeQueueActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encoded = encodeURIComponent(safeProjectId);
  return {
    pause: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/tree/control/pause`,
    },
    resume: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/tree/control/resume`,
    },
    abort: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/tree/control/abort`,
    },
    state: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/tree/state`,
    },
  };
}

function buildTreeQueueControlPayload({
  projectId = '',
  state = null,
  paused = false,
  cancelledRunIds = [],
  cancelledCount = null,
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    state,
    paused: paused === true,
    ...(Array.isArray(cancelledRunIds) ? { cancelledRunIds } : {}),
    ...(cancelledCount !== null && cancelledCount !== undefined
      ? { cancelledCount: Number.isFinite(Number(cancelledCount)) ? Number(cancelledCount) : 0 }
      : {}),
    actions: buildTreeQueueActions(projectId),
  };
}

function buildTreeSearchActions(projectId = '', nodeId = '', trialId = '') {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  if (!safeProjectId || !safeNodeId) return {};
  const encodedProjectId = encodeURIComponent(safeProjectId);
  const encodedNodeId = encodeURIComponent(safeNodeId);
  return {
    search: {
      method: 'GET',
      path: `/researchops/projects/${encodedProjectId}/tree/nodes/${encodedNodeId}/search`,
    },
    promoteTrial: trialId
      ? {
        method: 'POST',
        path: `/researchops/projects/${encodedProjectId}/tree/nodes/${encodedNodeId}/promote/${encodeURIComponent(cleanString(trialId))}`,
      }
      : {
        method: 'POST',
        pathTemplate: `/researchops/projects/${encodedProjectId}/tree/nodes/${encodedNodeId}/promote/{trialId}`,
      },
  };
}

function buildTreeSearchPayload({
  projectId = '',
  nodeId = '',
  search = null,
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    nodeId: cleanString(nodeId) || null,
    search,
    actions: buildTreeSearchActions(projectId, nodeId),
  };
}

function buildTreeSearchPromotionPayload({
  projectId = '',
  nodeId = '',
  trialId = '',
  promotedNodeId = '',
  plan = null,
  impact = null,
  validation = null,
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    nodeId: cleanString(nodeId) || null,
    trialId: cleanString(trialId) || null,
    promotedNodeId: cleanString(promotedNodeId) || null,
    plan,
    impact,
    validation,
    actions: buildTreeSearchActions(projectId, nodeId, trialId),
  };
}

module.exports = {
  buildTreeQueueControlPayload,
  buildTreeSearchPayload,
  buildTreeSearchPromotionPayload,
};
