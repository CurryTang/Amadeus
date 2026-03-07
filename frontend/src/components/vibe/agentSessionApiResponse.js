function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getAgentSessionsFromApiResponse(payload = null) {
  const root = asObject(payload);
  return Array.isArray(root.sessions) ? root.sessions : [];
}

function getAgentSessionDetailFromApiResponse(payload = null) {
  const root = asObject(payload);
  return {
    session: asObject(root.session).id ? root.session : null,
    activeRun: asObject(root.activeRun).id ? root.activeRun : null,
    activeAttempt: asObject(root.activeAttempt).id ? root.activeAttempt : null,
  };
}

function getActiveAgentSessionAttemptLabel(detail = null) {
  const parsed = getAgentSessionDetailFromApiResponse(detail);
  return cleanString(parsed.activeAttempt?.treeNodeTitle)
    || cleanString(parsed.activeAttempt?.treeNodeId)
    || cleanString(parsed.activeRun?.id);
}

export {
  getActiveAgentSessionAttemptLabel,
  getAgentSessionDetailFromApiResponse,
  getAgentSessionsFromApiResponse,
};
