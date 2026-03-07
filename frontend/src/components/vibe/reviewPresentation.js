function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasManualApproval(node = {}) {
  return Array.isArray(node?.checks)
    && node.checks.some((item) => cleanString(item?.type).toLowerCase() === 'manual_approve');
}

function buildNodeReviewSummary(node = {}, nodeState = {}, runReport = {}) {
  const rows = [];
  if (hasManualApproval(node)) {
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
      ? `${deliverableArtifactIds.length} deliverable artifacts`
      : 'No deliverable artifacts yet',
  });

  return rows;
}

export {
  buildNodeReviewSummary,
};
