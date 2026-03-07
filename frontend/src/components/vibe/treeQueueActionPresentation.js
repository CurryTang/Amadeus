function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeQueueActionMessage(action = '') {
  const normalized = cleanString(action).toLowerCase();
  if (normalized === 'pause') return 'Tree queue paused.';
  if (normalized === 'resume') return 'Tree queue resumed.';
  if (normalized === 'abort') return 'Tree queue aborted.';
  return `Tree queue ${normalized || 'action'} completed.`;
}

export {
  buildTreeQueueActionMessage,
};
