'use strict';

const { deriveRunWorkspacePath, findRunReportHighlights } = require('./run-report-view');
const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');
const { buildRunOutputContractView } = require('./output-contract-view.service');
const { buildEnvSnapshotView, buildWorkspaceSnapshotView } = require('./snapshot-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRunReportPayload({
  run,
  steps,
  artifacts,
  checkpoints,
  summaryText,
  manifest,
  mapArtifact = (item) => item,
}) {
  const runWorkspacePath = cleanString(deriveRunWorkspacePath(run, {
    stepResults: steps,
  }));
  const list = Array.isArray(artifacts) ? artifacts : [];
  return {
    run,
    attempt: buildAttemptViewFromRun(run),
    execution: buildRunExecutionView(run),
    steps: Array.isArray(steps) ? steps : [],
    artifacts: list.map((item) => mapArtifact(item, run)),
    checkpoints: Array.isArray(checkpoints) ? checkpoints : [],
    runWorkspacePath: runWorkspacePath || null,
    workspace: {
      path: runWorkspacePath || null,
    },
    workspaceSnapshot: buildWorkspaceSnapshotView(run, list, runWorkspacePath),
    envSnapshot: buildEnvSnapshotView(run),
    followUp: buildRunFollowUpView(run),
    contract: buildRunOutputContractView(run, manifest),
    highlights: findRunReportHighlights(list),
    summary: summaryText,
    manifest,
  };
}

module.exports = {
  buildRunReportPayload,
};
