'use strict';

const { deriveRunWorkspacePath, findRunReportHighlights } = require('./run-report-view');
const { buildAttemptViewFromRun } = require('./attempt-view.service');
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
    steps: Array.isArray(steps) ? steps : [],
    artifacts: list.map((item) => mapArtifact(item, run)),
    checkpoints: Array.isArray(checkpoints) ? checkpoints : [],
    runWorkspacePath: runWorkspacePath || null,
    workspace: {
      path: runWorkspacePath || null,
    },
    workspaceSnapshot: buildWorkspaceSnapshotView(run, list, runWorkspacePath),
    envSnapshot: buildEnvSnapshotView(run),
    highlights: findRunReportHighlights(list),
    summary: summaryText,
    manifest,
  };
}

module.exports = {
  buildRunReportPayload,
};
