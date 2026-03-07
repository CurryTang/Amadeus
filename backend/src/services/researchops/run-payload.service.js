'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');

function buildRunPayload({ run = null } = {}) {
  return {
    run,
    attempt: buildAttemptViewFromRun(run || {}),
    execution: buildRunExecutionView(run || {}),
  };
}

module.exports = {
  buildRunPayload,
};
