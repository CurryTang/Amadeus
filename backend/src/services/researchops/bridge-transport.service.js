'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readBridgeTransportMode(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'daemon-task') return 'daemon-task';
  return 'http';
}

function assertBridgeDaemonTransportReady(bridgeRuntime = null) {
  const serverId = cleanString(bridgeRuntime?.serverId);
  if (!serverId) {
    const error = new Error('Bridge transport requires a client daemon serverId');
    error.code = 'BRIDGE_DAEMON_UNAVAILABLE';
    throw error;
  }
  if (bridgeRuntime?.supportsLocalBridgeWorkflow !== true) {
    const missing = Array.isArray(bridgeRuntime?.missingBridgeTaskTypes)
      ? bridgeRuntime.missingBridgeTaskTypes
      : [];
    const suffix = missing.length > 0 ? ` Missing tasks: ${missing.join(', ')}` : '';
    const error = new Error(`Client daemon does not support local bridge workflow.${suffix}`);
    error.code = 'BRIDGE_DAEMON_UNSUPPORTED';
    error.missingBridgeTaskTypes = missing;
    throw error;
  }
  return serverId;
}

module.exports = {
  readBridgeTransportMode,
  assertBridgeDaemonTransportReady,
};
