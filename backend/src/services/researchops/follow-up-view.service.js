'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildRunFollowUpView(run = {}) {
  const metadata = asObject(run?.metadata);
  const contextRefs = asObject(run?.contextRefs);
  const relatedRunIds = Array.isArray(contextRefs.continueRunIds)
    ? contextRefs.continueRunIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const parentRunId = cleanString(metadata.parentRunId) || null;
  const continuationOfRunId = cleanString(metadata.continuationOfRunId) || null;
  const continuationPhase = cleanString(metadata.continuationPhase) || null;
  const branchLabel = cleanString(metadata.branchLabel) || null;
  return {
    parentRunId,
    continuationOfRunId,
    continuationPhase,
    branchLabel,
    relatedRunIds,
    isContinuation: Boolean(parentRunId || continuationOfRunId || continuationPhase || branchLabel),
  };
}

module.exports = {
  buildRunFollowUpView,
};
