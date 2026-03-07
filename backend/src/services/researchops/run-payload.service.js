'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');

function buildRunPayload({ run = null } = {}) {
  return {
    run,
    attempt: buildAttemptViewFromRun(run || {}),
    execution: buildRunExecutionView(run || {}),
    followUp: buildRunFollowUpView(run || {}),
  };
}

module.exports = {
  buildRunPayload,
};
