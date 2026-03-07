function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildObservedSessionActionMessage(action = '', payload = {}) {
  const normalized = cleanString(action).toLowerCase();
  const item = payload?.item && typeof payload.item === 'object' ? payload.item : {};
  const label = cleanString(item.detachedNodeTitle || item.title || item.id || payload?.sessionId);
  if (normalized === 'refresh') {
    return `Refreshed observed session for ${label}.`;
  }
  return `Completed ${normalized || 'session action'} for ${label}.`;
}

export {
  buildObservedSessionActionMessage,
};
