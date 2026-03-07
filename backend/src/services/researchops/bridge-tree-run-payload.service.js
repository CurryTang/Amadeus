'use strict';

const { buildRunPayload } = require('./run-payload.service');

function buildBridgeTreeRunPayload({
  projectId = '',
  nodeId = '',
  result = {},
} = {}) {
  const source = result && typeof result === 'object' ? result : {};
  const payload = {
    bridgeVersion: 'v0',
    projectId,
    nodeId,
    ...source,
  };
  if (payload.run && typeof payload.run === 'object') {
    const runPayload = buildRunPayload({ run: payload.run });
    payload.run = runPayload.run;
    payload.attempt = runPayload.attempt;
    payload.execution = runPayload.execution;
    payload.followUp = runPayload.followUp;
  }
  return payload;
}

module.exports = {
  buildBridgeTreeRunPayload,
};
