import { hasManualGate } from './treeNodePresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatDeliverableCount(count = 0) {
  const value = Math.max(Number(count) || 0, 0);
  return value === 1 ? '1 deliverable artifact' : `${value} deliverable artifacts`;
}

function buildNodeReviewSummary(node = {}, nodeState = {}, runReport = {}, runCompare = {}) {
  const rows = [];
  if (hasManualGate(node)) {
    rows.push({
      label: 'Gate',
      value: nodeState?.manualApproved ? 'Approved' : 'Awaiting manual approval',
    });
  }

  const checkpoints = Array.isArray(runReport?.checkpoints) ? runReport.checkpoints : [];
  if (checkpoints.length > 0) {
    const pendingCount = checkpoints.filter((item) => cleanString(item?.status).toUpperCase() === 'PENDING').length;
    const resolvedCount = Math.max(checkpoints.length - pendingCount, 0);
    rows.push({
      label: 'Checkpoints',
      value: pendingCount > 0 ? `${pendingCount} pending · ${resolvedCount} resolved` : `${resolvedCount} resolved`,
    });
  }

  const deliverableArtifactIds = Array.isArray(runReport?.highlights?.deliverableArtifactIds)
    ? runReport.highlights.deliverableArtifactIds.filter((item) => cleanString(item))
    : [];
  rows.push({
    label: 'Evidence',
    value: deliverableArtifactIds.length > 0
      ? formatDeliverableCount(deliverableArtifactIds.length)
      : 'No deliverable artifacts yet',
  });

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
