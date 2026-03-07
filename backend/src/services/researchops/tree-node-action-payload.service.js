'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeNodeApprovalPayload({
  projectId = '',
  nodeId = '',
  manualApproved = false,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  return {
    ok: true,
    projectId: safeProjectId || null,
    nodeId: safeNodeId || null,
    manualApproved: manualApproved === true,
    actions: (safeProjectId && safeNodeId) ? {
      approve: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/tree/nodes/${encodeURIComponent(safeNodeId)}/approve`,
      },
    } : {},
  };
}

function buildGeneratedTreeNodePayload({
  projectId = '',
  node = null,
  provider = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    projectId: safeProjectId || null,
    node: node && typeof node === 'object' ? node : null,
    provider: cleanString(provider) || null,
    actions: safeProjectId ? {
      generate: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/tree/nodes/from-todo`,
      },
      clarify: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/tree/nodes/from-todo/clarify`,
      },
    } : {},
  };
}

module.exports = {
  buildTreeNodeApprovalPayload,
  buildGeneratedTreeNodePayload,
};
