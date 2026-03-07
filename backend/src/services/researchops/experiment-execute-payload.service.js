'use strict';

const { buildRunPayload } = require('./run-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildExperimentExecutePayload({
  projectId = '',
  serverId = '',
  mode = '',
  result = null,
  run = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeServerId = cleanString(serverId);
  const normalizedMode = cleanString(mode) || null;
  const runPayload = buildRunPayload({ run });
  const source = asObject(result);
  const payload = {
    ...source,
    projectId: safeProjectId || null,
    serverId: safeServerId || null,
    mode: normalizedMode,
    actions: {
      execute: {
        method: 'POST',
        path: '/researchops/experiments/execute',
      },
    },
  };
  if (runPayload.run) {
    payload.run = runPayload.run;
    payload.attempt = runPayload.attempt;
    payload.execution = runPayload.execution;
    payload.followUp = runPayload.followUp;
    payload.contract = runPayload.contract;
    payload.actions.runDetail = {
      method: 'GET',
      path: `/researchops/runs/${encodeURIComponent(String(runPayload.run.id))}`,
    };
  }
  return payload;
}

module.exports = {
  buildExperimentExecutePayload,
};
