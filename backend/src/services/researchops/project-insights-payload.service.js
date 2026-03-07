'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildProjectScopedActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encoded = encodeURIComponent(safeProjectId);
  return {
    workspace: { method: 'GET', path: `/researchops/projects/${encoded}/workspace` },
    venvStatus: { method: 'GET', path: `/researchops/projects/${encoded}/venv/status` },
    venvSetup: { method: 'POST', path: `/researchops/projects/${encoded}/venv/setup` },
    gitLog: { method: 'GET', path: `/researchops/projects/${encoded}/git-log` },
    serverFiles: { method: 'GET', path: `/researchops/projects/${encoded}/server-files` },
    changedFiles: { method: 'GET', path: `/researchops/projects/${encoded}/changed-files` },
  };
}

function buildProjectWorkspacePayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    projectId: safeProjectId || null,
    ...asObject(result),
    actions: safeProjectId ? {
      workspace: actions.workspace,
      gitLog: actions.gitLog,
      serverFiles: actions.serverFiles,
      changedFiles: actions.changedFiles,
      venvStatus: actions.venvStatus,
    } : {},
  };
}

function buildProjectVenvStatusPayload({
  projectId = '',
  locationType = '',
  status = null,
  checkedAt = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    projectId: safeProjectId || null,
    locationType: cleanString(locationType) || null,
    status: asObject(status),
    checkedAt: cleanString(checkedAt) || null,
    actions: safeProjectId ? {
      status: actions.venvStatus,
      setup: actions.venvSetup,
    } : {},
  };
}

function buildProjectVenvSetupPayload({
  projectId = '',
  locationType = '',
  configuredTool = '',
  status = null,
  message = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    success: true,
    projectId: safeProjectId || null,
    locationType: cleanString(locationType) || null,
    configuredTool: cleanString(configuredTool) || null,
    status: asObject(status),
    message: cleanString(message) || null,
    actions: safeProjectId ? {
      setup: actions.venvSetup,
      status: actions.venvStatus,
      workspace: actions.workspace,
    } : {},
  };
}

function buildProjectGitLogPayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    projectId: safeProjectId || null,
    ...asObject(result),
    actions: safeProjectId ? {
      gitLog: actions.gitLog,
      workspace: actions.workspace,
      changedFiles: actions.changedFiles,
    } : {},
  };
}

function buildProjectServerFilesPayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    projectId: safeProjectId || null,
    ...asObject(result),
    actions: safeProjectId ? {
      serverFiles: actions.serverFiles,
      workspace: actions.workspace,
    } : {},
  };
}

function buildProjectChangedFilesPayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const actions = buildProjectScopedActions(safeProjectId);
  return {
    projectId: safeProjectId || null,
    ...asObject(result),
    actions: safeProjectId ? {
      changedFiles: actions.changedFiles,
      gitLog: actions.gitLog,
      workspace: actions.workspace,
    } : {},
  };
}

module.exports = {
  buildProjectWorkspacePayload,
  buildProjectVenvStatusPayload,
  buildProjectVenvSetupPayload,
  buildProjectGitLogPayload,
  buildProjectServerFilesPayload,
  buildProjectChangedFilesPayload,
};
