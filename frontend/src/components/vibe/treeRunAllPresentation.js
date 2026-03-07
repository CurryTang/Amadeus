function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTreeRunAllMessage(payload = {}) {
  if (!payload || typeof payload !== 'object') return 'Run-all request submitted.';
  const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
  const scopedNodes = cleanNumber(summary.scopedNodes);
  const queued = cleanNumber(summary.queued);
  const blocked = cleanNumber(summary.blocked);
  if (scopedNodes <= 0) return 'Run-all request submitted.';
  return `Run-all queued ${queued} of ${scopedNodes} nodes; ${blocked} blocked.`;
}

export {
  buildTreeRunAllMessage,
};
