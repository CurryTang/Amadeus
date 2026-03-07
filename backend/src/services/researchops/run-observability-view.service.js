'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(
    asArray(values)
      .map((item) => cleanString(item))
      .filter(Boolean)
  )].sort((left, right) => left.localeCompare(right));
}

function formatPendingCheckpointWarning(count = 0) {
  const value = Math.max(Number(count) || 0, 0);
  return `${value} checkpoints pending review`;
}

function buildRunObservabilityView({
  steps = [],
  artifacts = [],
  checkpoints = [],
  summaryText = '',
  manifest = null,
  highlights = null,
  contract = null,
} = {}) {
  const normalizedManifest = asObject(manifest);
  const normalizedSummary = asObject(normalizedManifest.summary);
  const normalizedObservability = asObject(normalizedManifest.observability);
  const normalizedHighlights = asObject(highlights);
  const normalizedContract = asObject(contract);
  const normalizedSteps = asArray(steps);
  const normalizedArtifacts = asArray(artifacts);
  const normalizedCheckpoints = asArray(checkpoints);
  const deliverableArtifactIds = uniqueStrings(normalizedHighlights.deliverableArtifactIds);
  const pendingCheckpoints = normalizedCheckpoints.filter(
    (item) => cleanString(item?.status).toUpperCase() === 'PENDING'
  ).length;
  const resolvedCheckpoints = Math.max(normalizedCheckpoints.length - pendingCheckpoints, 0);
  const sinkProviders = uniqueStrings(Object.keys(asObject(normalizedObservability.sinks)));
  const warnings = uniqueStrings([
    ...(normalizedContract.ok === false ? ['Contract validation failed'] : []),
    ...(pendingCheckpoints > 0 ? [formatPendingCheckpointWarning(pendingCheckpoints)] : []),
    ...asArray(normalizedObservability.warnings),
  ]);
  const hasSummary = Boolean(cleanString(summaryText));
  const hasFinalOutput = Boolean(cleanString(normalizedHighlights.finalOutputArtifactId));
  const hasDeliverables = deliverableArtifactIds.length > 0;
  const hasContractFailures = normalizedContract.ok === false;
  const hasWarnings = warnings.length > 0;
  const hasObservabilitySinks = sinkProviders.length > 0;

  let readiness = 'pending_outputs';
  if (hasContractFailures || pendingCheckpoints > 0 || hasWarnings) {
    readiness = 'needs_attention';
  } else if (hasSummary || hasFinalOutput || hasDeliverables) {
    readiness = 'ready';
  }

  return {
    counts: {
      steps: normalizedSteps.length,
      artifacts: normalizedArtifacts.length,
      deliverables: deliverableArtifactIds.length,
      checkpoints: normalizedCheckpoints.length,
      pendingCheckpoints,
      resolvedCheckpoints,
      tables: Math.max(Number(normalizedSummary.tableCount) || 0, 0),
      figures: Math.max(Number(normalizedSummary.figureCount) || 0, 0),
      metrics: Math.max(Number(normalizedSummary.metricArtifactCount) || 0, 0),
      sinks: sinkProviders.length,
      warnings: warnings.length,
    },
    flags: {
      hasSummary,
      hasFinalOutput,
      hasDeliverables,
      hasPendingCheckpoints: pendingCheckpoints > 0,
      hasContractFailures,
      hasWarnings,
      hasObservabilitySinks,
    },
    statuses: {
      evidence: hasSummary || hasFinalOutput || hasDeliverables ? 'present' : 'missing',
      checkpoints: pendingCheckpoints > 0 ? 'pending' : (normalizedCheckpoints.length > 0 ? 'resolved' : 'none'),
      contract: normalizedContract.ok === true ? 'validated' : (normalizedContract.ok === false ? 'failing' : 'unknown'),
      observability: hasWarnings ? 'warnings' : (hasObservabilitySinks ? 'configured' : 'none'),
      readiness,
    },
    sinkProviders,
    warnings,
  };
}

module.exports = {
  buildRunObservabilityView,
};
