'use strict';

const { buildRunPayload } = require('./run-payload.service');

function buildTreeRunStepPayload({
  projectId = '',
  nodeId = '',
  result = {},
} = {}) {
  const payload = {
    projectId,
    nodeId,
    ...(result && typeof result === 'object' ? result : {}),
  };
  if (payload?.run && typeof payload.run === 'object') {
    const runPayload = buildRunPayload({ run: payload.run });
    payload.attempt = runPayload.attempt;
    payload.execution = runPayload.execution;
    payload.followUp = runPayload.followUp;
    payload.contract = runPayload.contract;
  }
  return payload;
}

module.exports = {
  buildTreeRunStepPayload,
};
