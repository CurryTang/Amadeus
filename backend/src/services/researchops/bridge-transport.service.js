'use strict';

const { readRustDaemonConfig } = require('./rust-daemon-runtime.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readBridgeTransportMode(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'daemon-task') return 'daemon-task';
  if (normalized === 'rust-daemon') return 'rust-daemon';
  return 'http';
}

function resolveBridgeTransportMode({
  transport = '',
  bridgeRuntime = null,
  env = process.env,
} = {}) {
  const raw = cleanString(transport);
  if (raw) return readBridgeTransportMode(raw);
  return selectPreferredBridgeTransport({ bridgeRuntime, env });
}

function listBridgeTransportModes({ bridgeRuntime = null, env = process.env } = {}) {
  const modes = ['http'];
  const serverId = cleanString(bridgeRuntime?.serverId);
  if (serverId && bridgeRuntime?.supportsLocalBridgeWorkflow === true) {
    modes.push('daemon-task');
  }
  if (readRustDaemonConfig(env).enabled) {
    modes.push('rust-daemon');
  }
  return modes;
}

function buildBridgeTransportEnum(options = {}) {
  return listBridgeTransportModes(options)
    .map((mode) => `"${mode}"`)
    .join('|');
}

function selectPreferredBridgeTransport(options = {}) {
  const modes = listBridgeTransportModes(options);
  if (modes.includes('daemon-task')) return 'daemon-task';
  if (modes.includes('rust-daemon')) return 'rust-daemon';
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

function assertRustDaemonTransportReady(env = process.env) {
  const config = readRustDaemonConfig(env);
  if (!config.enabled) {
    const error = new Error('Rust daemon transport is not configured');
    error.code = 'RUST_DAEMON_UNAVAILABLE';
    throw error;
  }
  return config;
}

module.exports = {
  assertRustDaemonTransportReady,
  buildBridgeTransportEnum,
  listBridgeTransportModes,
  readBridgeTransportMode,
  resolveBridgeTransportMode,
  selectPreferredBridgeTransport,
  assertBridgeDaemonTransportReady,
};
