'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');

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
    payload.attempt = buildAttemptViewFromRun(payload.run);
  }
  return payload;
}

module.exports = {
  buildTreeRunStepPayload,
};
