'use strict';

const {
  buildBridgeDaemonTaskActions,
  buildBridgeDaemonTaskSubmitHints,
} = require('./bridge-daemon-task-action.service');
const { buildBridgeRuntimeView } = require('./bridge-runtime-view.service');
const { buildRunPreviewView } = require('./run-preview-view.service');
const { buildRunPayload } = require('./run-payload.service');

function buildBridgeTreeRunPayload({
  projectId = '',
  nodeId = '',
  bridgeRuntime = null,
  result = {},
} = {}) {
  const source = result && typeof result === 'object' ? result : {};
  const normalizedBridgeRuntime = buildBridgeRuntimeView(bridgeRuntime);
  const payload = {
    bridgeVersion: 'v0',
    projectId,
    nodeId,
    ...source,
    ...(normalizedBridgeRuntime ? { bridgeRuntime: normalizedBridgeRuntime } : {}),
  };
  if (payload.run && typeof payload.run === 'object') {
    const runPayload = buildRunPayload({ run: payload.run });
    payload.run = runPayload.run;
    payload.attempt = runPayload.attempt;
    payload.execution = runPayload.execution;
    payload.followUp = runPayload.followUp;
    payload.contract = runPayload.contract;
  }
  payload.taskActions = buildBridgeDaemonTaskActions({
    serverId: normalizedBridgeRuntime?.serverId,
    projectId,
    nodeId,
    runId: payload.run?.id,
    sourceServerId: payload.execution?.serverId,
  });
  payload.taskSubmitHints = buildBridgeDaemonTaskSubmitHints();
  if (payload.runPayloadPreview && typeof payload.runPayloadPreview === 'object') {
    payload.runPreview = buildRunPreviewView(payload.runPayloadPreview);
  }
  return payload;
}

module.exports = {
  buildBridgeTreeRunPayload,
};
