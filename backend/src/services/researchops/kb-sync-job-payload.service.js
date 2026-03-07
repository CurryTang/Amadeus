'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildKbSyncJobActions(projectId = '', jobId = '') {
  const safeProjectId = cleanString(projectId);
  const safeJobId = cleanString(jobId);
  if (!safeProjectId) return {};
  const actions = {
    start: {
      method: 'POST',
      path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/sync-group`,
    },
  };
  if (safeJobId) {
    actions.detail = {
      method: 'GET',
      path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/sync-jobs/${encodeURIComponent(safeJobId)}`,
    };
  }
  return actions;
}

function buildKbSyncJobPayload({
  projectId = '',
  job = null,
} = {}) {
  const source = job && typeof job === 'object' ? job : null;
  const jobId = cleanString(source?.id);
  return {
    projectId: cleanString(projectId) || null,
    jobId: jobId || null,
    job: source,
    actions: buildKbSyncJobActions(projectId, jobId),
  };
}

function buildKbSyncJobAcceptedPayload({
  projectId = '',
  message = '',
  job = null,
} = {}) {
  const payload = buildKbSyncJobPayload({ projectId, job });
  return {
    accepted: true,
    message: cleanString(message) || null,
    ...payload,
  };
}

module.exports = {
  buildKbSyncJobPayload,
  buildKbSyncJobAcceptedPayload,
};
