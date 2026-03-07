'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildProjectFileTreePayload({
  projectId = '',
  rootMode = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = asObject(result);
  return {
    projectId: safeProjectId || null,
    rootMode: cleanString(rootMode) || null,
    ...source,
    actions: safeProjectId ? {
      listTree: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/tree`,
      },
      searchFiles: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/search`,
      },
    } : {},
  };
}

function buildProjectFileContentPayload({
  projectId = '',
  rootMode = '',
  result = null,
  scope = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeScope = cleanString(scope) || 'project';
  const source = asObject(result);
  const safePath = cleanString(source.path);
  return {
    projectId: safeProjectId || null,
    rootMode: cleanString(rootMode) || null,
    ...source,
    actions: safeProjectId ? {
      readFile: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/content?path=${encodeURIComponent(safePath)}&scope=${encodeURIComponent(safeScope)}`,
      },
      listTree: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/tree?scope=${encodeURIComponent(safeScope)}`,
      },
    } : {},
  };
}

function buildProjectKbResourceLocatePayload({
  projectId = '',
  rootPath = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = asObject(result);
  return {
    projectId: safeProjectId || null,
    rootMode: 'kb-folder',
    rootPath: cleanString(rootPath) || null,
    ...source,
    actions: safeProjectId ? {
      locateResources: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/resource-locate`,
      },
      listKbTree: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/tree?scope=kb`,
      },
    } : {},
  };
}

module.exports = {
  buildProjectFileTreePayload,
  buildProjectFileContentPayload,
  buildProjectKbResourceLocatePayload,
};
