'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeStructureActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encoded = encodeURIComponent(safeProjectId);
  return {
    plan: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/tree/plan`,
    },
    state: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/tree/state`,
    },
    rootNode: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/tree/root-node`,
    },
  };
}

function buildTreeRootNodePayload({
  projectId = '',
  generated = false,
  rootNode = null,
  summary = null,
  achievements = [],
  snapshot = null,
  plan = null,
  validation = null,
  degraded = null,
  refreshedAt = '',
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    generated: generated === true,
    rootNode,
    summary,
    achievements: Array.isArray(achievements) ? achievements : [],
    snapshot,
    plan,
    validation,
    degraded,
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    actions: buildTreeStructureActions(projectId),
  };
}

function buildTreeStatePayload({
  projectId = '',
  state = null,
  paths = null,
  degraded = null,
  refreshedAt = '',
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    state,
    paths,
    degraded,
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    actions: buildTreeStructureActions(projectId),
  };
}

module.exports = {
  buildTreeRootNodePayload,
  buildTreeStatePayload,
};
