'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildProjectRepoMapPayload({
  projectId = '',
  commit = '',
  force = false,
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = asObject(result);
  return {
    projectId: safeProjectId || null,
    commit: cleanString(commit) || null,
    force: Boolean(force),
    ...source,
    actions: safeProjectId ? {
      read: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/context/repo-map`,
      },
      rebuild: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/context/repo-map/rebuild`,
      },
    } : {},
  };
}

module.exports = {
  buildProjectRepoMapPayload,
};
