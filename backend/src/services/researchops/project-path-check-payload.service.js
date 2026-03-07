'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectPathCheckPayload(result = {}) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return {
    ...source,
    locationType: cleanString(source.locationType) || null,
    clientMode: cleanString(source.clientMode) || null,
    clientDeviceId: cleanString(source.clientDeviceId) || null,
    clientWorkspaceId: cleanString(source.clientWorkspaceId) || null,
    serverId: cleanString(source.serverId) || null,
    projectPath: cleanString(source.projectPath) || null,
    exists: source.exists === true,
    isDirectory: source.isDirectory === true,
    canCreate: source.canCreate === true,
    viaProxy: source.viaProxy === true,
    deferred: source.deferred === true,
    message: cleanString(source.message) || null,
    actions: {
      checkPath: {
        method: 'POST',
        path: '/researchops/projects/path-check',
      },
      ...(source.actions && typeof source.actions === 'object' ? source.actions : {}),
    },
  };
}

module.exports = {
  buildProjectPathCheckPayload,
};
