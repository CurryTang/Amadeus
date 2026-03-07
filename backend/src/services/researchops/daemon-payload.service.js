'use strict';

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

function buildDaemonCapabilities() {
  return {
    canClaimTasks: true,
    builtInTaskTypes: [
      'project.checkPath',
      'project.ensurePath',
      'project.ensureGit',
    ],
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
    capabilities: buildDaemonCapabilities(),
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

function buildDaemonListPayload({ items = [] } = {}) {
  return {
    items: (Array.isArray(items) ? items : [])
      .map((item) => normalizeDaemon(item))
      .filter(Boolean),
  };
}

module.exports = {
  buildDaemonHeartbeatPayload,
  buildDaemonListPayload,
  buildDaemonRegistrationPayload,
  normalizeDaemon,
};
