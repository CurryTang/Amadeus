'use strict';

const { buildBridgeRunReportPayload } = require('./bridge-run-report-payload.service');
const { buildNodeBridgeContextPayload } = require('./node-bridge-context-payload.service');
const { buildRunReportPayload } = require('./run-report-payload.service');

function buildNodeBridgeView({
  projectId = '',
  node = null,
  nodeState = null,
  blocking = null,
  run = null,
  contextPack = null,
  bridgeRuntime = null,
  reportSteps = [],
  reportArtifacts = [],
  reportCheckpoints = [],
} = {}) {
  const bridgeReport = run
    ? buildBridgeRunReportPayload({
      report: buildRunReportPayload({
        run,
        steps: reportSteps,
        artifacts: reportArtifacts,
        checkpoints: reportCheckpoints,
      }),
    })
    : null;
  return buildNodeBridgeContextPayload({
    projectId,
    node,
    nodeState,
    blocking,
    run,
    contextPack,
    bridgeReport,
    bridgeRuntime,
  });
}

module.exports = {
  buildNodeBridgeView,
};
