'use strict';

const { OPTIONAL_BRIDGE_DAEMON_TASK_TYPES, missingDaemonTaskTypes } = require('./daemon-task-descriptor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildProjectBridgeRuntime(project = {}, device = null) {
  const locationType = cleanString(project?.locationType).toLowerCase();
  const clientMode = cleanString(project?.clientMode).toLowerCase();
  if (locationType !== 'client' || clientMode !== 'agent') {
    return null;
  }
  const serverId = cleanString(project?.clientDeviceId)
    || cleanString(device?.id)
    || cleanString(device?.serverId);
  const supportedTaskTypes = Array.isArray(device?.supportedTaskTypes) && device.supportedTaskTypes.length > 0
    ? device.supportedTaskTypes.map((item) => cleanString(item)).filter(Boolean)
    : ['project.checkPath', 'project.ensurePath', 'project.ensureGit'];
  const missingBridgeTaskTypes = missingDaemonTaskTypes(device, OPTIONAL_BRIDGE_DAEMON_TASK_TYPES);
  return {
    executionTarget: 'client-daemon',
    serverId: serverId || null,
    supportsLocalBridgeWorkflow: missingBridgeTaskTypes.length === 0,
    missingBridgeTaskTypes,
    supportedTaskTypes,
  };
}

module.exports = {
  buildProjectBridgeRuntime,
};
