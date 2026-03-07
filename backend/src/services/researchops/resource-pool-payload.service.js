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

function normalizeResourcePoolServer(server = null) {
  if (!server || typeof server !== 'object') return null;
  const resources = asObject(server.resources);
  return {
    ...(server && typeof server === 'object' ? server : {}),
    status: cleanString(server.status).toUpperCase() || 'UNKNOWN',
    execution: {
      serverId: cleanString(server.serverId),
      backend: 'local',
      runtimeClass: '',
      resources: {
        gpu: normalizeResourceBucket(resources.gpu),
        cpuMemoryGb: normalizeResourceBucket(resources.cpuMemoryGb),
      },
    },
  };
}

function buildResourcePoolPayload({
  aggregate = {},
  servers = [],
  dispatcher = {},
  refreshedAt = '',
} = {}) {
  return {
    aggregate: asObject(aggregate),
    servers: (Array.isArray(servers) ? servers : [])
      .map((server) => normalizeResourcePoolServer(server))
      .filter(Boolean),
    dispatcher: asObject(dispatcher),
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
  };
}

module.exports = {
  buildResourcePoolPayload,
  normalizeResourcePoolServer,
};
