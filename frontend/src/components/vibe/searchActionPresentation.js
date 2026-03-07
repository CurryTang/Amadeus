function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildSearchActionMessage(action = '', payload = {}) {
  const normalized = cleanString(action).toLowerCase();
  const nodeId = cleanString(payload?.nodeId);
  const trials = Array.isArray(payload?.search?.trials) ? payload.search.trials.length : 0;
  if (normalized === 'refresh') {
    return trials > 0
      ? `Refreshed search ${nodeId} with ${trials} trials.`
      : `Refreshed search ${nodeId}.`;
  }
  return `Completed ${normalized || 'search action'} for ${nodeId}.`;
}

export {
  buildSearchActionMessage,
};
