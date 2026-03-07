'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildRunObservabilityActions(runId = '') {
  const safeRunId = cleanString(runId);
  if (!safeRunId) return {};
  return {
    report: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/report`,
    },
    observability: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/observability`,
    },
    artifacts: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/artifacts`,
    },
    checkpoints: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/checkpoints`,
    },
    events: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/events`,
    },
    bridgeReport: {
      method: 'GET',
      path: `/researchops/runs/${safeRunId}/bridge-report`,
    },
  };
}

function buildRunObservabilityPayload({ report = null } = {}) {
  const source = asObject(report);
  const run = asObject(source.run);
  const runId = cleanString(run.id);
  return {
    runId: runId || null,
    status: cleanString(run.status) || null,
    attempt: source.attempt || null,
    execution: source.execution || null,
    followUp: source.followUp || null,
    contract: source.contract || null,
    highlights: asObject(source.highlights),
    observability: source.observability || null,
    actions: buildRunObservabilityActions(runId),
  };
}

module.exports = {
  buildRunObservabilityPayload,
};
