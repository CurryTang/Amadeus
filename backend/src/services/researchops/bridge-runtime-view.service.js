'use strict';

const {
  listBridgeTransportModes,
  selectPreferredBridgeTransport,
} = require('./bridge-transport.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTaskTypes(values = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const taskType = cleanString(raw);
    if (!taskType || seen.has(taskType)) continue;
    seen.add(taskType);
    normalized.push(taskType);
  }
  return normalized;
}

function buildBridgeRuntimeCapabilities(supportedTaskTypes = []) {
  const supported = normalizeTaskTypes(supportedTaskTypes);
  return {
    canFetchNodeContext: supported.includes('bridge.fetchNodeContext'),
    canFetchContextPack: supported.includes('bridge.fetchContextPack'),
    canSubmitNodeRun: supported.includes('bridge.submitNodeRun'),
    canFetchRunReport: supported.includes('bridge.fetchRunReport'),
    canSubmitRunNote: supported.includes('bridge.submitRunNote'),
  };
}

function buildBridgeRuntimeView(bridgeRuntime = null, { env = process.env } = {}) {
  if (!bridgeRuntime || typeof bridgeRuntime !== 'object') return null;
  const supportedTaskTypes = normalizeTaskTypes(bridgeRuntime.supportedTaskTypes);
  const missingBridgeTaskTypes = normalizeTaskTypes(bridgeRuntime.missingBridgeTaskTypes);
  const availableTransports = listBridgeTransportModes({ bridgeRuntime, env });
  return {
    executionTarget: cleanString(bridgeRuntime.executionTarget) || null,
    serverId: cleanString(bridgeRuntime.serverId) || null,
    supportsLocalBridgeWorkflow: bridgeRuntime.supportsLocalBridgeWorkflow === true,
    missingBridgeTaskTypes,
    supportedTaskTypes,
    availableTransports,
    preferredTransport: selectPreferredBridgeTransport({ bridgeRuntime, env }),
    capabilities: buildBridgeRuntimeCapabilities(supportedTaskTypes),
  };
}

module.exports = {
  buildBridgeRuntimeView,
};
