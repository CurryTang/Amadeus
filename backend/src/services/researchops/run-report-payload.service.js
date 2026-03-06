'use strict';

const { findRunReportHighlights } = require('./run-report-view');
const { buildAttemptViewFromRun } = require('./attempt-view.service');

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
  const runWorkspacePath = cleanString(run?.metadata?.runWorkspacePath);
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
    highlights: findRunReportHighlights(list),
    summary: summaryText,
    manifest,
  };
}

module.exports = {
  buildRunReportPayload,
};
