'use strict';

const {
  ALL_OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  BUILT_IN_DAEMON_TASK_TYPES,
  OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  DAEMON_TASK_CATALOG_VERSION,
  missingDaemonTaskTypes,
  normalizeDaemonTaskTypes,
  listDaemonTaskDescriptors,
  contextualizeDaemonTaskDescriptor,
} = require('./daemon-task-descriptor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeResourceBucket(value = {}) {
  const source = asObject(value);
  const total = Number.isFinite(Number(source.total)) ? Number(source.total) : 0;
  const available = Number.isFinite(Number(source.available)) ? Number(source.available) : 0;
  return { total, available };
}

function inferLocation(labels = {}) {
  const role = cleanString(asObject(labels).role).toLowerCase();
  if (role === 'client-device') return 'client';
  return 'local';
}

function buildDaemonActions() {
  return {
    register: {
      method: 'POST',
      path: '/researchops/daemons/register',
    },
    heartbeat: {
      method: 'POST',
      path: '/researchops/daemons/heartbeat',
    },
    claimTask: {
      method: 'POST',
      path: '/researchops/daemons/tasks/claim',
    },
    completeTask: {
      method: 'POST',
      pathTemplate: '/researchops/daemons/tasks/{taskId}/complete',
    },
  };
}

function buildDaemonCapabilities(daemon = null) {
  const source = asObject(daemon);
  const supportedTaskTypes = normalizeDaemonTaskTypes(source.supportedTaskTypes);
  const effectiveSupportedTaskTypes = supportedTaskTypes.length > 0 ? supportedTaskTypes : BUILT_IN_DAEMON_TASK_TYPES;
  const projectBootstrapTaskTypes = ['project.ensurePath', 'project.ensureGit'];
  const missingProjectTaskTypes = missingDaemonTaskTypes(
    { supportedTaskTypes: effectiveSupportedTaskTypes },
    projectBootstrapTaskTypes,
  );
  const missingBridgeTaskTypes = missingDaemonTaskTypes(
    { supportedTaskTypes: effectiveSupportedTaskTypes },
    OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  );
  const supportsWorkspaceSnapshotCapture = effectiveSupportedTaskTypes.includes('bridge.captureWorkspaceSnapshot');
  return {
    canClaimTasks: true,
    taskCatalogVersion: cleanString(source.taskCatalogVersion) || DAEMON_TASK_CATALOG_VERSION,
    builtInTaskTypes: BUILT_IN_DAEMON_TASK_TYPES,
    optionalTaskTypes: ALL_OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
    supportedTaskTypes: effectiveSupportedTaskTypes,
    supportsProjectBootstrap: missingProjectTaskTypes.length === 0,
    missingProjectTaskTypes,
    supportsLocalBridgeWorkflow: missingBridgeTaskTypes.length === 0,
    supportsWorkspaceSnapshotCapture,
    missingBridgeTaskTypes,
    taskDescriptors: listDaemonTaskDescriptors()
      .map((descriptor) => contextualizeDaemonTaskDescriptor(descriptor?.taskType, {
        supportedTaskTypes: effectiveSupportedTaskTypes,
      }))
      .filter(Boolean),
  };
}

function normalizeDaemon(daemon = null) {
  if (!daemon || typeof daemon !== 'object') return null;
  const labels = asObject(daemon.labels);
  const capacity = asObject(daemon.capacity);
  const concurrencyLimit = Number.isFinite(Number(daemon.concurrencyLimit))
    ? Number(daemon.concurrencyLimit)
    : 1;
  return {
    ...(daemon && typeof daemon === 'object' ? daemon : {}),
    status: cleanString(daemon.status).toUpperCase() || 'ONLINE',
    labels,
    capacity,
    concurrencyLimit,
    heartbeatAt: cleanString(daemon.heartbeatAt) || null,
    supportedTaskTypes: normalizeDaemonTaskTypes(daemon.supportedTaskTypes),
    taskCatalogVersion: cleanString(daemon.taskCatalogVersion) || null,
    execution: {
      serverId: cleanString(daemon.id),
      location: inferLocation(labels),
      registration: 'daemon',
      concurrencyLimit,
      resources: {
        gpu: normalizeResourceBucket(capacity.gpu),
        cpuMemoryGb: normalizeResourceBucket(capacity.cpuMemoryGb),
      },
    },
    actions: buildDaemonActions(),
    capabilities: buildDaemonCapabilities(daemon),
  };
}

function buildDaemonRegistrationPayload({ daemon = null } = {}) {
  const normalized = normalizeDaemon(daemon);
  return {
    serverId: cleanString(normalized?.id),
    hostname: cleanString(normalized?.hostname),
    status: cleanString(normalized?.status),
    heartbeatAt: normalized?.heartbeatAt || null,
    daemon: normalized,
  };
}

function buildDaemonHeartbeatPayload({ daemon = null } = {}) {
  return buildDaemonRegistrationPayload({ daemon });
}

function buildDaemonListPayload({ items = [], limit = null } = {}) {
  return {
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    items: (Array.isArray(items) ? items : [])
      .map((item) => normalizeDaemon(item))
      .filter(Boolean),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/daemons',
      },
    },
  };
}

module.exports = {
  buildDaemonHeartbeatPayload,
  buildDaemonListPayload,
  buildDaemonRegistrationPayload,
  normalizeDaemon,
};
