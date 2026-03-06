function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTimestamp(updatedAt = '') {
  const ts = cleanString(updatedAt);
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getObservedSessionProviderLabel(item = {}) {
  const provider = cleanString(item?.provider).toLowerCase();
  if (provider === 'codex') return 'Codex';
  if (provider === 'claude_code') return 'Claude';
  return 'Agent';
}

function getObservedSessionNodeLabel(item = {}) {
  const detachedNodeId = cleanString(item?.detachedNodeId);
  if (!detachedNodeId) return 'Unlinked';
  const detachedNodeTitle = cleanString(item?.detachedNodeTitle);
  return detachedNodeTitle ? `Node: ${detachedNodeTitle}` : `Node: ${detachedNodeId}`;
}

function buildObservedSessionCards(items = []) {
  if (!Array.isArray(items)) return [];
  return [...items]
    .sort((a, b) => cleanString(b?.updatedAt).localeCompare(cleanString(a?.updatedAt)))
    .map((item) => ({
      id: cleanString(item?.id),
      title: cleanString(item?.title) || cleanString(item?.promptDigest) || 'Observed session',
      digest: cleanString(item?.latestProgressDigest) || cleanString(item?.promptDigest),
      providerLabel: getObservedSessionProviderLabel(item),
      observedLabel: 'Observed',
      nodeLabel: getObservedSessionNodeLabel(item),
      status: cleanString(item?.status).toUpperCase() || 'UNKNOWN',
      timestamp: formatTimestamp(item?.updatedAt),
      detachedNodeId: cleanString(item?.detachedNodeId),
      raw: item,
    }));
}

export {
  buildObservedSessionCards,
  getObservedSessionNodeLabel,
  getObservedSessionProviderLabel,
};
