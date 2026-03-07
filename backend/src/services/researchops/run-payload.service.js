'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');
const { buildRunOutputContractView } = require('./output-contract-view.service');
const { buildWorkspaceSnapshotView, buildEnvSnapshotView } = require('./snapshot-view.service');
const { buildThinRunObservabilityView } = require('./run-thin-observability-view.service');
const { buildThinRunOutputView } = require('./run-thin-output-view.service');

function buildRunPayload({ run = null } = {}) {
  return {
    run,
    attempt: buildAttemptViewFromRun(run || {}),
    execution: buildRunExecutionView(run || {}),
    followUp: buildRunFollowUpView(run || {}),
    contract: buildRunOutputContractView(run || {}),
    workspaceSnapshot: buildWorkspaceSnapshotView(run || {}),
    envSnapshot: buildEnvSnapshotView(run || {}),
    observability: buildThinRunObservabilityView(run || {}),
    output: buildThinRunOutputView(run || {}),
    resolvedTransport: run?.resolvedTransport || run?.metadata?.resolvedTransport || null,
  };
}

module.exports = {
  buildRunPayload,
};
