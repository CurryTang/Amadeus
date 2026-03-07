'use strict';

const {
  BUILT_IN_DAEMON_TASK_TYPES,
  OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  DAEMON_TASK_CATALOG_VERSION,
  listDaemonTaskDescriptors,
} = require('./daemon-task-descriptor.service');

function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function cleanObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

const CLIENT_AGENT_BRIDGE_ROUTE_TEMPLATES = {
  nodeBridgeContext: '/researchops/projects/{projectId}/tree/nodes/{nodeId}/bridge-context',
  nodeBridgeRun: '/researchops/projects/{projectId}/tree/nodes/{nodeId}/bridge-run',
  runContextPack: '/researchops/runs/{runId}/context-pack',
  runReport: '/researchops/runs/{runId}/report',
  runArtifacts: '/researchops/runs/{runId}/artifacts',
  runBridgeReport: '/researchops/runs/{runId}/bridge-report',
  runBridgeNote: '/researchops/runs/{runId}/bridge-note',
};

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
      executionTarget: 'client-daemon',
      supportsLocalBridgeWorkflow: true,
      daemonTaskCatalogVersion: DAEMON_TASK_CATALOG_VERSION,
      daemonTaskTypes: BUILT_IN_DAEMON_TASK_TYPES,
      optionalDaemonTaskTypes: OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
      daemonTaskDescriptors: listDaemonTaskDescriptors(),
      bridgeRouteTemplates: CLIENT_AGENT_BRIDGE_ROUTE_TEMPLATES,
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

function buildProjectPayload({ project = null, git = undefined } = {}) {
  const normalizedProject = project && typeof project === 'object' ? project : null;
  const projectId = cleanString(normalizedProject?.id);
  const payload = {
    projectId,
    project: normalizedProject,
    capabilities: deriveProjectCapabilities(normalizedProject || {}),
    location: {
      locationType: cleanString(normalizedProject?.locationType).toLowerCase() || 'local',
      clientMode: cleanString(normalizedProject?.clientMode).toLowerCase() || null,
      clientDeviceId: cleanString(normalizedProject?.clientDeviceId) || null,
      clientWorkspaceId: cleanString(normalizedProject?.clientWorkspaceId) || null,
      serverId: cleanString(normalizedProject?.serverId) || null,
      projectPath: cleanString(normalizedProject?.projectPath) || null,
    },
    actions: projectId ? {
      detail: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(projectId)}`,
      },
      agentSessions: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(projectId)}/agent-sessions`,
      },
      observedSessions: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(projectId)}/observed-sessions`,
      },
      treePlan: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(projectId)}/tree/plan`,
      },
    } : {},
  };

  if (git !== undefined) {
    payload.git = git;
  }

  return payload;
}

function normalizeProjectListItem(project = null) {
  const payload = buildProjectPayload({ project });
  return {
    ...(project && typeof project === 'object' ? project : {}),
    capabilities: payload.capabilities,
    location: payload.location,
    actions: payload.actions,
  };
}

function buildProjectListPayload({ items = [], limit = null } = {}) {
  return {
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeProjectListItem(item)),
  };
}

module.exports = {
  normalizeProjectLocationPayload,
  deriveProjectCapabilities,
  assertProjectExecutionAllowed,
  buildProjectPayload,
  buildProjectListPayload,
};
