'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildExecutionJobSpec } = require('./execution-view.service');
const { buildWorkspaceSnapshotView, buildEnvSnapshotView } = require('./snapshot-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTokenList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => cleanString(item))
      .filter(Boolean)
  )];
}

function normalizeOutputContract(outputContract = {}) {
  const source = asObject(outputContract);
  return {
    requiredArtifacts: normalizeTokenList(source.requiredArtifacts),
    tables: normalizeTokenList(source.tables),
    figures: normalizeTokenList(source.figures),
    metricKeys: normalizeTokenList(source.metricKeys),
    summaryRequired: Boolean(source.summaryRequired),
  };
}

function normalizeContextRefs(contextRefs = {}) {
  const source = asObject(contextRefs);
  const normalized = Object.entries(source).reduce((acc, [key, value]) => {
    if (Array.isArray(value)) {
      const list = normalizeTokenList(value);
      if (list.length > 0) {
        acc[key] = list;
      }
      return acc;
    }
    const text = cleanString(value);
    if (text) {
      acc[key] = text;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : {};
}

function buildExecutionRequestPayload({
  run = null,
  artifacts = [],
  runWorkspacePath = '',
} = {}) {
  const source = asObject(run);
  const jobSpec = buildExecutionJobSpec(source);
  return {
    runId: cleanString(source.id) || null,
    projectId: cleanString(source.projectId) || null,
    attempt: buildAttemptViewFromRun(source),
    workspaceSnapshot: buildWorkspaceSnapshotView(source, artifacts, runWorkspacePath),
    envSnapshot: jobSpec || buildEnvSnapshotView(source),
    jobSpec,
    outputContract: normalizeOutputContract(source.outputContract),
    contextRefs: normalizeContextRefs(source.contextRefs),
  };
}

module.exports = {
  buildExecutionRequestPayload,
};
