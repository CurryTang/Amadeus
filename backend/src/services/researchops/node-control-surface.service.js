'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildNodeControlSurface({
  run = null,
  report = null,
  runtimeSummary = null,
} = {}) {
  const sourceRun = asObject(run);
  const sourceReport = asObject(report);
  const execution = asObject(sourceReport.execution);
  const output = asObject(sourceReport.output);
  const highlights = asObject(sourceReport.highlights);
  const workspaceSnapshot = asObject(sourceReport.workspaceSnapshot);
  const observability = asObject(sourceReport.observability);
  const readinessStatuses = asObject(observability.statuses);
  const observabilityCounts = asObject(observability.counts);
  const contract = asObject(sourceReport.contract);
  const deliverableArtifactIds = Array.isArray(highlights.deliverableArtifactIds)
    ? highlights.deliverableArtifactIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const runtime = asObject(runtimeSummary);
  const latestRunState = cleanString(sourceRun.status).toUpperCase() || 'UNKNOWN';
  const contractState = contract.ok === false ? 'failing' : contract.ok === true ? 'passing' : 'unknown';
  const hasSummary = output.hasSummary === true || Boolean(cleanString(highlights.summaryArtifactId));
  const hasFinalOutput = output.hasFinalOutput === true || Boolean(cleanString(highlights.finalOutputArtifactId));
  const warnings = Math.max(Number(observabilityCounts.warnings) || 0, 0);
  let nextAction = 'review-output';
  if (cleanString(runtime.rustHealthState).toLowerCase() === 'degraded') {
    nextAction = 'fix-runtime';
  } else if (cleanString(execution.location).toLowerCase() === 'remote' && !cleanString(asObject(workspaceSnapshot.localSnapshot).kind)) {
    nextAction = 'sync-snapshot';
  } else if (latestRunState === 'FAILED' && contractState === 'passing' && warnings === 0 && hasFinalOutput) {
    nextAction = 'rerun';
  }
  return {
    review: {
      latestRunState,
      contractState,
      outputState: hasSummary && hasFinalOutput ? 'complete' : hasSummary || hasFinalOutput ? 'partial' : 'missing',
      deliverableCount: deliverableArtifactIds.length,
    },
    execution: {
      location: cleanString(execution.location) || 'unknown',
      backend: cleanString(execution.backend) || 'unknown',
      runtimeClass: cleanString(execution.runtimeClass) || 'unknown',
      transport: cleanString(sourceRun.resolvedTransport || sourceReport.resolvedTransport) || 'unknown',
      snapshotState: cleanString(asObject(workspaceSnapshot.localSnapshot).kind) ? 'snapshot-backed' : 'not-captured',
    },
    observability: {
      readiness: cleanString(readinessStatuses.readiness) || 'unknown',
      warnings,
      sinkProviders: Array.isArray(observability.sinkProviders)
        ? observability.sinkProviders.map((item) => cleanString(item)).filter(Boolean)
        : [],
    },
    recommendation: {
      nextAction,
    },
  };
}

module.exports = {
  buildNodeControlSurface,
};
