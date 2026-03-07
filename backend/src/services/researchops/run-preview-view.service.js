'use strict';

const { normalizeEnqueueRunPayload } = require('./enqueue-run-payload.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunOutputContractView } = require('./output-contract-view.service');
const { buildWorkspaceSnapshotView } = require('./snapshot-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRunPreviewView(input = {}) {
  const normalized = normalizeEnqueueRunPayload(input);
  const previewRun = {
    id: '',
    serverId: cleanString(normalized.serverId) || 'local-default',
    mode: cleanString(normalized.mode) || 'headless',
    outputContract: normalized.outputContract || {},
    metadata: normalized.metadata || {},
  };
  return {
    runType: cleanString(normalized.runType).toUpperCase() || '',
    serverId: cleanString(normalized.serverId) || 'local-default',
    command: cleanString(normalized.command),
    execution: buildRunExecutionView(previewRun),
    contract: buildRunOutputContractView(previewRun),
    workspaceSnapshot: buildWorkspaceSnapshotView(previewRun, [], ''),
  };
}

module.exports = {
  buildRunPreviewView,
};
