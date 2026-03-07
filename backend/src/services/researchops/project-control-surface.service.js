'use strict';

const { buildRunReviewSummary } = require('./run-review-summary.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeRuns(runs = []) {
  return Array.isArray(runs) ? runs : [];
}

function countMissingOutputs(runs = []) {
  return normalizeRuns(runs).filter((run) => {
    const output = asObject(run?.output);
    return output.hasSummary !== true || output.hasFinalOutput !== true;
  }).length;
}

function countWarnings(runs = []) {
  return normalizeRuns(runs).reduce((sum, run) => {
    const observability = asObject(run?.observability);
    const counts = asObject(observability.counts);
    return sum + Math.max(Number(counts.warnings) || 0, 0);
  }, 0);
}

function buildRuntimeMix(runs = []) {
  return [...new Set(normalizeRuns(runs).map((run) => {
    const execution = asObject(run?.execution);
    const backend = cleanString(execution.backend);
    const runtimeClass = cleanString(execution.runtimeClass);
    if (!backend && !runtimeClass) return '';
    return `${backend || 'unknown'}/${runtimeClass || 'default'}`;
  }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function buildNextAction({ reviewSummary = null, runtimeSummary = null, missingOutputs = 0, warnings = 0 } = {}) {
  const review = asObject(reviewSummary);
  const runtime = asObject(runtimeSummary);
  if (runtime.rustManagedDesired === true && runtime.rustManagedRunning !== true) {
    return 'fix-runtime';
  }
  if (cleanString(runtime.rustHealthState).toLowerCase() === 'degraded') {
    return 'fix-runtime';
  }
  if (Number(review.attentionCount || 0) > 0 || Number(review.contractFailureCount || 0) > 0 || missingOutputs > 0 || warnings > 0) {
    return 'review-output';
  }
  if (Number(review.remoteExecutionCount || 0) > Number(review.snapshotBackedCount || 0)) {
    return 'sync-snapshot';
  }
  return 'rerun';
}

function buildProjectControlSurface({
  runs = [],
  runtimeSummary = null,
} = {}) {
  const items = normalizeRuns(runs);
  const reviewSummary = buildRunReviewSummary(items);
  const runtime = asObject(runtimeSummary);
  const missingOutputs = countMissingOutputs(items);
  const warnings = countWarnings(items);
  return {
    review: {
      attentionRuns: Number(reviewSummary.attentionCount || 0),
      contractFailures: Number(reviewSummary.contractFailureCount || 0),
      missingOutputs,
      warnings,
      status: cleanString(reviewSummary.status) || 'idle',
    },
    runtime: {
      onlineClients: Number(runtime.onlineClients || 0),
      bridgeReadyClients: Number(runtime.bridgeReadyClients || 0),
      snapshotReadyClients: Number(runtime.snapshotReadyClients || 0),
      rustManagedRunning: runtime.rustManagedRunning === true,
      rustManagedDesired: runtime.rustManagedDesired === true,
      rustHealthState: cleanString(runtime.rustHealthState) || 'unknown',
      rustLastFailureReason: cleanString(runtime.rustLastFailureReason) || null,
      runtimeDrift: runtime.rustManagedDesired === true && runtime.rustManagedRunning !== true,
    },
    execution: {
      remoteRuns: Number(reviewSummary.remoteExecutionCount || 0),
      snapshotBackedRuns: Number(reviewSummary.snapshotBackedCount || 0),
      transportMix: Array.isArray(reviewSummary.resolvedTransports) ? [...reviewSummary.resolvedTransports] : [],
      runtimeMix: buildRuntimeMix(items),
    },
    observability: {
      instrumentedRuns: Number(reviewSummary.instrumentedCount || 0),
      sinkProviders: Array.isArray(reviewSummary.instrumentedProviders) ? [...reviewSummary.instrumentedProviders] : [],
    },
    recommendation: {
      backend: cleanString(runtime.recommendedBackend) || null,
      runtimeClass: cleanString(runtime.recommendedRuntimeClass) || null,
      reason: cleanString(runtime.recommendationReason) || null,
      nextAction: buildNextAction({
        reviewSummary,
        runtimeSummary: runtime,
        missingOutputs,
        warnings,
      }),
    },
  };
}

module.exports = {
  buildProjectControlSurface,
};
