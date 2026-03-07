'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildProjectKbFilesPayload({
  projectId = '',
  kbFolderPath = '',
  listing = null,
  refreshedAt = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = asObject(listing);
  return {
    projectId: safeProjectId || null,
    kbFolderPath: cleanString(kbFolderPath) || null,
    rootPath: cleanString(source.rootPath) || null,
    items: Array.isArray(source.items) ? source.items : [],
    totalFiles: Number.isFinite(Number(source.totalFiles)) ? Number(source.totalFiles) : 0,
    offset: Number.isFinite(Number(source.offset)) ? Number(source.offset) : 0,
    limit: Number.isFinite(Number(source.limit)) ? Number(source.limit) : null,
    hasMore: typeof source.hasMore === 'boolean' ? source.hasMore : false,
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    actions: safeProjectId ? {
      listKbFiles: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/files`,
      },
      listKbTree: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/tree?scope=kb`,
      },
    } : {},
  };
}

module.exports = {
  buildProjectKbFilesPayload,
};
