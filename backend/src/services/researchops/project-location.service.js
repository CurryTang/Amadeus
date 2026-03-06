'use strict';

function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function deriveProjectCapabilities(project = {}) {
  const locationType = cleanString(project.locationType).toLowerCase() || 'local';
  const clientMode = cleanString(project.clientMode).toLowerCase();

  if (locationType === 'client' && clientMode === 'browser') {
    return {
      canExecute: false,
      canGitInit: false,
      canBackgroundRun: false,
      canDeployLocal: true,
      requiresBrowserWorkspaceLink: true,
    };
  }

  if (locationType === 'client' && clientMode === 'agent') {
    return {
      canExecute: true,
      canGitInit: true,
      canBackgroundRun: true,
      canDeployLocal: true,
      requiresBrowserWorkspaceLink: false,
    };
  }

  return {
    canExecute: true,
    canGitInit: true,
    canBackgroundRun: true,
    canDeployLocal: locationType === 'local',
    requiresBrowserWorkspaceLink: false,
  };
}

function normalizeProjectLocationPayload(payload = {}) {
  const locationType = cleanString(payload.locationType).toLowerCase() || 'local';
  const clientMode = cleanString(payload.clientMode).toLowerCase() || null;
  const clientDeviceId = cleanString(payload.clientDeviceId) || null;
  const clientWorkspaceId = cleanString(payload.clientWorkspaceId) || null;
  const clientWorkspaceMeta = cleanObject(payload.clientWorkspaceMeta);
  const serverId = cleanString(payload.serverId) || null;
  const projectPath = cleanString(payload.projectPath) || null;

  if (locationType === 'local') {
    if (!projectPath) throw new Error('projectPath is required');
    return {
      locationType: 'local',
      clientMode: null,
      clientDeviceId: null,
      clientWorkspaceId: null,
      clientWorkspaceMeta: {},
      serverId: 'local-default',
      projectPath,
    };
  }

  if (locationType === 'ssh') {
    if (!serverId) throw new Error('serverId is required when locationType=ssh');
    if (!projectPath) throw new Error('projectPath is required');
    return {
      locationType: 'ssh',
      clientMode: null,
      clientDeviceId: null,
      clientWorkspaceId: null,
      clientWorkspaceMeta: {},
      serverId,
      projectPath,
    };
  }

  if (locationType === 'client') {
    if (clientMode === 'agent') {
      if (!clientDeviceId) throw new Error('clientDeviceId is required when clientMode=agent');
      if (!projectPath) throw new Error('projectPath is required when clientMode=agent');
      return {
        locationType: 'client',
        clientMode: 'agent',
        clientDeviceId,
        clientWorkspaceId: null,
        clientWorkspaceMeta,
        serverId: clientDeviceId,
        projectPath,
      };
    }

    if (clientMode === 'browser') {
      if (serverId) throw new Error('serverId must not be set for browser client projects');
      if (projectPath) throw new Error('projectPath must not be set for browser client projects');
      if (!clientWorkspaceId) throw new Error('clientWorkspaceId is required when clientMode=browser');
      return {
        locationType: 'client',
        clientMode: 'browser',
        clientDeviceId: null,
        clientWorkspaceId,
        clientWorkspaceMeta,
        serverId: null,
        projectPath: null,
      };
    }

    throw new Error('clientMode must be agent or browser');
  }

  throw new Error('locationType must be local, ssh, or client');
}

function assertProjectExecutionAllowed(project = {}, action = 'execution') {
  const capabilities = deriveProjectCapabilities(project);
  if (capabilities.canExecute) return;
  throw new Error(`Browser-backed client projects do not support ${action}`);
}

module.exports = {
  normalizeProjectLocationPayload,
  deriveProjectCapabilities,
  assertProjectExecutionAllowed,
};
