function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getTreeExecutionErrorMessage(error, fallback = 'Request failed') {
  const payload = error?.response?.data && typeof error.response.data === 'object'
    ? error.response.data
    : {};
  const code = cleanString(payload.code || error?.code);
  const baseMessage = cleanString(payload.error || error?.message) || fallback;
  const blockedBy = Array.isArray(payload.blockedBy) ? payload.blockedBy : [];
  if (code === 'NODE_BLOCKED' && blockedBy.length > 0) {
    const details = blockedBy
      .map((item) => cleanString(item?.depId || item?.check || item?.type))
      .filter(Boolean)
      .join(', ');
    return `${code}: ${baseMessage} (${details})`;
  }
  return code ? `${code}: ${baseMessage}` : baseMessage;
}

export {
  getTreeExecutionErrorMessage,
};
