function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeNodeActionMessage(action = '', payload = {}) {
  const normalizedAction = cleanString(action).toLowerCase();
  const nodeTitle = cleanString(payload?.nodeTitle || payload?.nodeId);
  if (normalizedAction === 'approve_gate') {
    return `Approved gate for ${nodeTitle}.`;
  }
  if (normalizedAction === 'promote') {
    const trialId = cleanString(payload?.trialId);
    return `Promoted winner ${trialId} from ${nodeTitle}.`;
  }
  return `Completed ${normalizedAction || 'action'} for ${nodeTitle}.`;
}

export {
  buildTreeNodeActionMessage,
};
