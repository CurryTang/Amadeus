'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');
const { buildRunOutputContractView } = require('./output-contract-view.service');
const { buildWorkspaceSnapshotView, buildEnvSnapshotView } = require('./snapshot-view.service');

function buildRunPayload({ run = null } = {}) {
  return {
    run,
    attempt: buildAttemptViewFromRun(run || {}),
    execution: buildRunExecutionView(run || {}),
    followUp: buildRunFollowUpView(run || {}),
    contract: buildRunOutputContractView(run || {}),
    workspaceSnapshot: buildWorkspaceSnapshotView(run || {}),
    envSnapshot: buildEnvSnapshotView(run || {}),
  };
}

module.exports = {
  buildRunPayload,
};
