import { hasManualGate } from './treeNodePresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatControlSurfaceNextActionLabel(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'fix-runtime') return 'Fix runtime';
  if (normalized === 'review-output') return 'Review output';
  if (normalized === 'sync-snapshot') return 'Sync snapshot';
  if (normalized === 'rerun') return 'Rerun';
  return '';
}

function formatContractOk(ok) {
  if (ok === true) return 'Validated';
  if (ok === false) return 'Validation failed';
  return '';
}

function formatDeliverableCount(count = 0) {
  const value = Math.max(Number(count) || 0, 0);
  return value === 1 ? '1 deliverable artifact' : `${value} deliverable artifacts`;
}

function formatReadiness(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'needs_attention') return 'Needs attention';
  if (normalized === 'pending_outputs') return 'Pending outputs';
  if (normalized === 'ready') return 'Ready';
  return '';
}

function formatSinkProviders(providers = []) {
  if (!Array.isArray(providers)) return '';
  const values = providers.map((item) => cleanString(item)).filter(Boolean);
  if (values.length === 0) return '';
  return values.join(', ');
}

function formatIsolationTier(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'none') return 'Host-native';
  if (normalized === 'lite') return 'Lite isolation';
  if (normalized === 'standard') return 'Standard isolation';
  if (normalized === 'guarded') return 'Guarded isolation';
  if (normalized === 'strong') return 'Strong isolation';
  return '';
}

function resolveNodeReport(runReport = {}, bridgeReport = {}) {
  const primaryReport = runReport && typeof runReport === 'object' ? runReport : {};
  if (Object.keys(primaryReport).length > 0) return primaryReport;
  const fallbackReport = bridgeReport?.report && typeof bridgeReport.report === 'object'
    ? bridgeReport.report
    : {};
  if (Object.keys(fallbackReport).length > 0) return fallbackReport;
  return {};
}

function buildNodeControlSurfaceRows({
  runReport = {},
  bridgeReport = {},
} = {}) {
  const effectiveRunReport = resolveNodeReport(runReport, bridgeReport);
  const rows = [];
  const run = effectiveRunReport?.run && typeof effectiveRunReport.run === 'object' ? effectiveRunReport.run : {};
  const execution = effectiveRunReport?.execution && typeof effectiveRunReport.execution === 'object'
    ? effectiveRunReport.execution
    : (bridgeReport?.execution && typeof bridgeReport.execution === 'object' ? bridgeReport.execution : {});
  const contract = effectiveRunReport?.contract && typeof effectiveRunReport.contract === 'object' ? effectiveRunReport.contract : {};
  const highlights = effectiveRunReport?.highlights && typeof effectiveRunReport.highlights === 'object' ? effectiveRunReport.highlights : {};
  const output = effectiveRunReport?.output && typeof effectiveRunReport.output === 'object' ? effectiveRunReport.output : {};
  const observability = effectiveRunReport?.observability && typeof effectiveRunReport.observability === 'object' ? effectiveRunReport.observability : {};
  const workspaceSnapshot = effectiveRunReport?.workspaceSnapshot && typeof effectiveRunReport.workspaceSnapshot === 'object'
    ? effectiveRunReport.workspaceSnapshot
    : {};
  const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
    ? workspaceSnapshot.localSnapshot
    : {};
  const deliverableCount = Array.isArray(highlights.deliverableArtifactIds)
    ? highlights.deliverableArtifactIds.filter((item) => cleanString(item)).length
    : 0;
  const hasSummary = output.hasSummary === true || Boolean(cleanString(highlights.summaryArtifactId));
  const hasFinalOutput = output.hasFinalOutput === true || Boolean(cleanString(highlights.finalOutputArtifactId));
  const outputState = hasSummary && hasFinalOutput ? 'Complete' : hasSummary || hasFinalOutput ? 'Partial' : 'Missing';
  const contractState = contract.ok === true ? 'Validated' : contract.ok === false ? 'Validation failed' : 'Unknown';
  const warningCount = Math.max(Number(observability?.counts?.warnings) || 0, 0);
  const sinkProviders = Array.isArray(observability?.sinkProviders)
    ? observability.sinkProviders.map((item) => cleanString(item)).filter(Boolean)
    : [];
  let nextAction = '';
  if (contract.ok === false || warningCount > 0 || !hasFinalOutput) {
    nextAction = 'review-output';
  } else if (cleanString(execution.location).toLowerCase() === 'remote' && !cleanString(localSnapshot.kind)) {
    nextAction = 'sync-snapshot';
  } else if (cleanString(run.status).toUpperCase() === 'FAILED') {
    nextAction = 'rerun';
  }

  if (cleanString(run.status)) rows.push({ label: 'Run State', value: cleanString(run.status).toUpperCase() });
  rows.push({ label: 'Contract State', value: contractState });
  rows.push({ label: 'Output State', value: outputState });
  rows.push({ label: 'Deliverables', value: String(deliverableCount) });
  if (cleanString(execution.location)) rows.push({ label: 'Execution', value: cleanString(execution.location) });
  if (cleanString(execution.backend) || cleanString(execution.runtimeClass)) {
    rows.push({
      label: 'Runtime',
      value: [cleanString(execution.backend), cleanString(execution.runtimeClass)].filter(Boolean).join('/'),
    });
  }
  if (cleanString(effectiveRunReport?.resolvedTransport || bridgeReport?.resolvedTransport)) {
    rows.push({ label: 'Transport', value: cleanString(effectiveRunReport?.resolvedTransport || bridgeReport?.resolvedTransport) });
  }
  if (cleanString(localSnapshot.kind)) rows.push({ label: 'Snapshot State', value: 'Snapshot-backed' });
  if (cleanString(observability?.statuses?.readiness)) rows.push({ label: 'Readiness', value: formatReadiness(observability.statuses.readiness) || cleanString(observability.statuses.readiness) });
  if (warningCount > 0) rows.push({ label: 'Warnings', value: warningCount === 1 ? '1 warning' : `${warningCount} warnings` });
  if (sinkProviders.length > 0) rows.push({ label: 'Sinks', value: sinkProviders.join(', ') });
  const nextActionLabel = formatControlSurfaceNextActionLabel(nextAction);
  if (nextActionLabel) rows.push({ label: 'Next Action', value: nextActionLabel });
  return rows;
}

function buildNodeReviewSummary(node = {}, nodeState = {}, runReport = {}, runCompare = {}, bridgeReport = {}) {
  const effectiveRunReport = resolveNodeReport(runReport, bridgeReport);
  const rows = [];
  if (hasManualGate(node)) {
    rows.push({
      label: 'Gate',
      value: nodeState?.manualApproved ? 'Approved' : 'Awaiting manual approval',
    });
  }

  const checkpoints = Array.isArray(effectiveRunReport?.checkpoints) ? effectiveRunReport.checkpoints : [];
  if (checkpoints.length > 0) {
    const pendingCount = checkpoints.filter((item) => cleanString(item?.status).toUpperCase() === 'PENDING').length;
    const resolvedCount = Math.max(checkpoints.length - pendingCount, 0);
    rows.push({
      label: 'Checkpoints',
      value: pendingCount > 0 ? `${pendingCount} pending · ${resolvedCount} resolved` : `${resolvedCount} resolved`,
    });
  }

  const deliverableArtifactIds = Array.isArray(effectiveRunReport?.highlights?.deliverableArtifactIds)
    ? effectiveRunReport.highlights.deliverableArtifactIds.filter((item) => cleanString(item))
    : [];
  rows.push({
    label: 'Evidence',
    value: deliverableArtifactIds.length > 0
      ? formatDeliverableCount(deliverableArtifactIds.length)
      : 'No deliverable artifacts yet',
  });
  if (cleanString(effectiveRunReport?.summary) || cleanString(effectiveRunReport?.highlights?.summaryArtifactId)) {
    rows.push({
      label: 'Summary',
      value: 'Present',
    });
  }
  if (cleanString(effectiveRunReport?.highlights?.finalOutputArtifactId)) {
    rows.push({
      label: 'Final Output',
      value: 'Present',
    });
  }
  const contractStatus = formatContractOk(effectiveRunReport?.contract?.ok ?? runReport?.contract?.ok ?? bridgeReport?.contract?.ok);
  if (contractStatus) {
    rows.push({
      label: 'Contract',
      value: contractStatus,
    });
  }
  const execution = effectiveRunReport?.execution && typeof effectiveRunReport.execution === 'object'
    ? effectiveRunReport.execution
    : (bridgeReport?.execution && typeof bridgeReport.execution === 'object'
      ? bridgeReport.execution
      : {});
  const executionRuntimeProfile = execution?.runtimeProfile && typeof execution.runtimeProfile === 'object'
    ? execution.runtimeProfile
    : {};
  const executionLocation = cleanString(execution.location);
  const executionRuntime = [
    cleanString(execution.backend),
    cleanString(execution.runtimeClass),
  ].filter(Boolean).join('/');
  const executionIsolation = formatIsolationTier(executionRuntimeProfile.isolationTier);
  const executionRuntimeWarning = cleanString(executionRuntimeProfile.compatibilityWarning);
  if (executionLocation) {
    rows.push({
      label: 'Execution',
      value: executionLocation,
    });
  }
  if (executionRuntime) {
    rows.push({
      label: 'Runtime',
      value: executionRuntime,
    });
  }
  if (executionIsolation) {
    rows.push({
      label: 'Isolation',
      value: executionIsolation,
    });
  }
  if (executionRuntimeWarning) {
    rows.push({
      label: 'Runtime Warning',
      value: executionRuntimeWarning,
    });
  }

  const observability = effectiveRunReport?.observability && typeof effectiveRunReport.observability === 'object'
    ? effectiveRunReport.observability
    : {};
  const readiness = cleanString(observability?.statuses?.readiness).toLowerCase();
  const warningCount = Math.max(Number(observability?.counts?.warnings) || 0, 0);
  const sinkProviders = formatSinkProviders(observability?.sinkProviders);
  const resolvedTransport = cleanString(effectiveRunReport?.resolvedTransport || bridgeReport?.resolvedTransport);
  const workspaceSnapshot = effectiveRunReport?.workspaceSnapshot && typeof effectiveRunReport.workspaceSnapshot === 'object'
    ? effectiveRunReport.workspaceSnapshot
    : (bridgeReport?.report?.workspaceSnapshot && typeof bridgeReport.report.workspaceSnapshot === 'object'
      ? bridgeReport.report.workspaceSnapshot
      : {});
  const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
    ? workspaceSnapshot.localSnapshot
    : {};
  if (readiness === 'ready') {
    rows.push({
      label: 'Readiness',
      value: 'Ready',
    });
  } else if (readiness === 'needs_attention') {
    rows.push({
      label: 'Readiness',
      value: 'Needs attention',
    });
  } else if (readiness === 'pending_outputs') {
    rows.push({
      label: 'Readiness',
      value: 'Pending outputs',
    });
  }
  if (warningCount > 0) {
    rows.push({
      label: 'Warnings',
      value: warningCount === 1 ? '1 warning' : `${warningCount} warnings`,
    });
  }
  if (sinkProviders) {
    rows.push({
      label: 'Sinks',
      value: sinkProviders,
    });
  }
  if (cleanString(localSnapshot.kind) || cleanString(localSnapshot.note)) {
    rows.push({
      label: 'Snapshot',
      value: 'Snapshot-backed',
    });
  }
  if (resolvedTransport) {
    rows.push({
      label: 'Transport',
      value: resolvedTransport,
    });
  }

  const bridgeRuntime = effectiveRunReport?.bridgeRuntime && typeof effectiveRunReport.bridgeRuntime === 'object'
    ? effectiveRunReport.bridgeRuntime
    : (bridgeReport?.bridgeRuntime && typeof bridgeReport.bridgeRuntime === 'object'
      ? bridgeReport.bridgeRuntime
      : {});
  const missingBridgeTaskTypes = Array.isArray(bridgeRuntime.missingBridgeTaskTypes)
    ? bridgeRuntime.missingBridgeTaskTypes.filter((item) => cleanString(item))
    : [];
  if (bridgeRuntime.supportsLocalBridgeWorkflow === true) {
    rows.push({
      label: 'Bridge',
      value: 'Local bridge ready',
    });
  } else if (missingBridgeTaskTypes.length > 0) {
    rows.push({
      label: 'Bridge',
      value: `Missing ${missingBridgeTaskTypes.length} tasks`,
    });
  }

  const otherRunId = cleanString(runCompare?.other?.run?.id);
  if (otherRunId) {
    const compareObservability = runCompare?.other?.report?.observability
      && typeof runCompare.other.report.observability === 'object'
      ? runCompare.other.report.observability
      : {};
    const otherExecutionLocation = cleanString(runCompare?.other?.execution?.location);
    const otherRuntimeProfile = runCompare?.other?.execution?.runtimeProfile
      && typeof runCompare.other.execution.runtimeProfile === 'object'
      ? runCompare.other.execution.runtimeProfile
      : {};
    const otherExecutionRuntime = [
      cleanString(runCompare?.other?.execution?.backend),
      cleanString(runCompare?.other?.execution?.runtimeClass),
    ].filter(Boolean).join('/');
    const otherExecutionIsolation = formatIsolationTier(otherRuntimeProfile.isolationTier);
    const otherResolvedTransport = cleanString(runCompare?.other?.resolvedTransport);
    const otherContractStatus = formatContractOk(runCompare?.other?.contract?.ok);
    const otherReadiness = formatReadiness(compareObservability?.statuses?.readiness);
    const otherWarningsCount = Math.max(Number(compareObservability?.counts?.warnings) || 0, 0);
    const otherSinkProviders = formatSinkProviders(compareObservability?.sinkProviders);
    const compareWorkspaceSnapshot = runCompare?.other?.report?.workspaceSnapshot
      && typeof runCompare.other.report.workspaceSnapshot === 'object'
      ? runCompare.other.report.workspaceSnapshot
      : (runCompare?.other?.workspaceSnapshot && typeof runCompare.other.workspaceSnapshot === 'object'
        ? runCompare.other.workspaceSnapshot
        : {});
    const compareLocalSnapshot = compareWorkspaceSnapshot?.localSnapshot
      && typeof compareWorkspaceSnapshot.localSnapshot === 'object'
      ? compareWorkspaceSnapshot.localSnapshot
      : {};
    rows.push({
      label: 'Compare',
      value: otherRunId,
    });
    rows.push({
      label: 'Compare Status',
      value: cleanString(runCompare?.other?.run?.status).toUpperCase() || 'UNKNOWN',
    });
    if (runCompare?.relation?.sameNode) {
      rows.push({
        label: 'Compare Node',
        value: 'Same node',
      });
    }
    if (otherReadiness) {
      rows.push({
        label: 'Compare Readiness',
        value: otherReadiness,
      });
    }
    if (otherWarningsCount > 0) {
      rows.push({
        label: 'Compare Warnings',
        value: otherWarningsCount === 1 ? '1 warning' : `${otherWarningsCount} warnings`,
      });
    }
    if (otherSinkProviders) {
      rows.push({
        label: 'Compare Sinks',
        value: otherSinkProviders,
      });
    }
    if (otherExecutionLocation) {
      rows.push({
        label: 'Compare Execution',
        value: otherExecutionLocation,
      });
    }
    if (otherExecutionRuntime) {
      rows.push({
        label: 'Compare Runtime',
        value: otherExecutionRuntime,
      });
    }
    if (otherExecutionIsolation) {
      rows.push({
        label: 'Compare Isolation',
        value: otherExecutionIsolation,
      });
    }
    if (otherResolvedTransport) {
      rows.push({
        label: 'Compare Transport',
        value: otherResolvedTransport,
      });
    }
    if (otherContractStatus) {
      rows.push({
        label: 'Compare Contract',
        value: otherContractStatus,
      });
    }
    if (cleanString(compareLocalSnapshot.kind) || cleanString(compareLocalSnapshot.note)) {
      rows.push({
        label: 'Compare Snapshot',
        value: 'Snapshot-backed',
      });
    }
    if (
      cleanString(runCompare?.other?.report?.summary)
      || cleanString(runCompare?.other?.report?.highlights?.summaryArtifactId)
    ) {
      rows.push({
        label: 'Compare Summary',
        value: 'Present',
      });
    }
    if (cleanString(runCompare?.other?.report?.highlights?.finalOutputArtifactId)) {
      rows.push({
        label: 'Compare Final Output',
        value: 'Present',
      });
    }
    const otherDeliverableArtifactIds = Array.isArray(runCompare?.other?.report?.highlights?.deliverableArtifactIds)
      ? runCompare.other.report.highlights.deliverableArtifactIds.filter((item) => cleanString(item))
      : [];
    rows.push({
      label: 'Compare Evidence',
      value: otherDeliverableArtifactIds.length > 0
        ? formatDeliverableCount(otherDeliverableArtifactIds.length)
        : 'No deliverable artifacts yet',
    });
  }

  return rows;
}

export {
  buildNodeControlSurfaceRows,
  buildNodeReviewSummary,
  formatControlSurfaceNextActionLabel,
};
