'use strict';

const { buildBridgeDaemonTaskActions } = require('./bridge-daemon-task-action.service');
const { buildBridgeRuntimeView } = require('./bridge-runtime-view.service');
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
  bridgeRuntime = null,
  mapArtifact = (item) => item,
}) {
  const runWorkspacePath = cleanString(deriveRunWorkspacePath(run, {
    stepResults: steps,
  }));
  const list = Array.isArray(artifacts) ? artifacts : [];
  const attempt = buildAttemptViewFromRun(run);
  const normalizedBridgeRuntime = buildBridgeRuntimeView(bridgeRuntime);
  return {
    run,
    attempt,
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
    bridgeRuntime: normalizedBridgeRuntime && Object.keys(normalizedBridgeRuntime).length > 0 ? normalizedBridgeRuntime : null,
    taskActions: buildBridgeDaemonTaskActions({
      serverId: normalizedBridgeRuntime?.serverId,
      projectId: cleanString(run?.projectId),
      nodeId: cleanString(attempt?.treeNodeId || attempt?.nodeId),
      runId: cleanString(run?.id),
    }),
    summary: summaryText,
    manifest,
  };
}

module.exports = {
  buildRunReportPayload,
};
