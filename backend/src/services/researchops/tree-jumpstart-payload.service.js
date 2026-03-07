'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildJumpstartActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encoded = encodeURIComponent(safeProjectId);
  return {
    jumpstart: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/tree/jumpstart`,
    },
    plan: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/tree/plan`,
    },
    state: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/tree/state`,
    },
  };
}

function buildTreeJumpstartPayload({
  projectId = '',
  projectMode = '',
  nodes = [],
  plan = null,
  validation = null,
  autoRun = null,
  autoRunError = null,
  updatedAt = '',
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    projectMode: cleanString(projectMode) || null,
    nodes: Array.isArray(nodes) ? nodes : [],
    plan,
    validation,
    autoRun,
    autoRunError,
    updatedAt: cleanString(updatedAt) || new Date().toISOString(),
    actions: buildJumpstartActions(projectId),
  };
}

module.exports = {
  buildTreeJumpstartPayload,
};
