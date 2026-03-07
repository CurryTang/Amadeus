'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectKbSetupPayload({
  projectId = '',
  message = '',
  inspection = null,
  project = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    ok: true,
    success: true,
    projectId: safeProjectId || null,
    message: cleanString(message) || null,
    inspection: inspection && typeof inspection === 'object' ? inspection : null,
    project: project && typeof project === 'object' ? project : null,
    actions: safeProjectId ? {
      setupFromResource: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/kb/setup-from-resource`,
      },
    } : {},
  };
}

function buildProjectGitRestorePayload({
  projectId = '',
  runId = '',
  branch = '',
  commit = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeRunId = cleanString(runId);
  return {
    ok: true,
    projectId: safeProjectId || null,
    runId: safeRunId || null,
    branch: cleanString(branch) || null,
    commit: cleanString(commit) || null,
    actions: safeProjectId ? {
      restoreRun: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/git/restore`,
      },
      ...(safeRunId ? {
        runDetail: {
          method: 'GET',
          path: `/researchops/runs/${encodeURIComponent(safeRunId)}`,
        },
      } : {}),
    } : {},
  };
}

module.exports = {
  buildProjectKbSetupPayload,
  buildProjectGitRestorePayload,
};
