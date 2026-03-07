'use strict';

const { buildRunPayload } = require('./run-payload.service');

function buildPlanActions() {
  return {
    generate: {
      method: 'POST',
      path: '/researchops/plan/generate',
    },
    enqueueV2: {
      method: 'POST',
      path: '/researchops/plan/enqueue-v2',
    },
  };
}

function buildGeneratedPlanPayload({
  plan = null,
  todoCandidates = null,
  todoDsl = null,
  referenceSummary = null,
} = {}) {
  return {
    plan,
    todoCandidates: Array.isArray(todoCandidates) ? todoCandidates : null,
    todoDsl: todoDsl && typeof todoDsl === 'object' ? todoDsl : null,
    referenceSummary: referenceSummary && typeof referenceSummary === 'object' ? referenceSummary : null,
    actions: buildPlanActions(),
  };
}

function buildEnqueuedPlanPayload({
  plan = null,
  run = null,
} = {}) {
  const runPayload = buildRunPayload({ run });
  const actions = buildPlanActions();
  if (runPayload.run?.id) {
    actions.runDetail = {
      method: 'GET',
      path: `/researchops/runs/${encodeURIComponent(String(runPayload.run.id))}`,
    };
  }
  return {
    plan,
    run: runPayload.run,
    attempt: runPayload.attempt,
    execution: runPayload.execution,
    followUp: runPayload.followUp,
    contract: runPayload.contract,
    actions,
  };
}

module.exports = {
  buildGeneratedPlanPayload,
  buildEnqueuedPlanPayload,
};
