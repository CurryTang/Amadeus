'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectDeletePayload({
  projectId = '',
  force = false,
  deleteStorage = true,
  summary = null,
} = {}) {
  return {
    success: true,
    projectId: cleanString(projectId) || null,
    force: force === true,
    deleteStorage: deleteStorage !== false,
    summary: summary && typeof summary === 'object' && !Array.isArray(summary) ? summary : {},
    actions: {
      listProjects: {
        method: 'GET',
        path: '/researchops/projects',
      },
      createProject: {
        method: 'POST',
        path: '/researchops/projects',
      },
    },
  };
}

module.exports = {
  buildProjectDeletePayload,
};
