'use strict';

const { buildBridgeDaemonTaskActions } = require('./bridge-daemon-task-action.service');
const { buildBridgeRuntimeView } = require('./bridge-runtime-view.service');
const { deriveRunWorkspacePath, findRunReportHighlights } = require('./run-report-view');
const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');
const { buildRunObservabilityView } = require('./run-observability-view.service');
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
  const normalizedHighlights = findRunReportHighlights(list);
  const contract = buildRunOutputContractView(run, manifest);
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
    contract,
    highlights: normalizedHighlights,
    observability: buildRunObservabilityView({
      steps,
      artifacts: list,
      checkpoints,
      summaryText,
      manifest,
      highlights: normalizedHighlights,
      contract,
    }),
    bridgeRuntime: normalizedBridgeRuntime && Object.keys(normalizedBridgeRuntime).length > 0 ? normalizedBridgeRuntime : null,
    taskActions: buildBridgeDaemonTaskActions({
      serverId: normalizedBridgeRuntime?.serverId,
      projectId: cleanString(run?.projectId),
      nodeId: cleanString(attempt?.treeNodeId || attempt?.nodeId),
      runId: cleanString(run?.id),
      sourceServerId: cleanString(run?.serverId),
    }),
    summary: summaryText,
    manifest,
  };
}

module.exports = {
  buildRunReportPayload,
};
