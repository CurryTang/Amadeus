import { hasManualGate } from './treeNodePresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDeliverableCount(count = 0) {
  const value = Math.max(Number(count) || 0, 0);
  return value === 1 ? '1 deliverable artifact' : `${value} deliverable artifacts`;
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

  const observability = effectiveRunReport?.observability && typeof effectiveRunReport.observability === 'object'
    ? effectiveRunReport.observability
    : {};
  const readiness = cleanString(observability?.statuses?.readiness).toLowerCase();
  const warningCount = Math.max(Number(observability?.counts?.warnings) || 0, 0);
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
  buildNodeReviewSummary,
};
