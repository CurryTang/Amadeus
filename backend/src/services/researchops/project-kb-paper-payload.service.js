'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectKbAddPaperPayload({
  projectId = '',
  documentId = '',
  results = null,
  paperFolder = '',
  documentTitle = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    ok: true,
    projectId: safeProjectId || null,
    documentId: cleanString(documentId) || null,
    results: results && typeof results === 'object' && !Array.isArray(results) ? results : {},
    paperFolder: cleanString(paperFolder) || null,
    documentTitle: cleanString(documentTitle) || null,
    actions: safeProjectId ? {
      addPaper: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/add-paper`,
      },
      filesTree: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/files/tree?scope=kb`,
      },
    } : {},
  };
}

module.exports = {
  buildProjectKbAddPaperPayload,
};
