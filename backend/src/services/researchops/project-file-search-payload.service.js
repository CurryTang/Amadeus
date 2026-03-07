'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectFileSearchPayload({
  projectId = '',
  scope = '',
  query = '',
  limit = null,
  rootMode = '',
  items = [],
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    projectId: safeProjectId || null,
    scope: cleanString(scope) || null,
    query: cleanString(query) || null,
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    rootMode: cleanString(rootMode) || null,
    items: Array.isArray(items) ? items : [],
    actions: safeProjectId ? {
      search: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/search`,
      },
    } : {},
  };
}

module.exports = {
  buildProjectFileSearchPayload,
};
