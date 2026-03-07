function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getAgentSessionMessagesFromApiResponse(payload = null) {
  const root = asObject(payload);
  return Array.isArray(root.items) ? root.items : [];
}

function getAgentSessionMessageActionFromApiResponse(payload = null) {
  const root = asObject(payload);
  return {
    session: asObject(root.session).id ? root.session : null,
    run: asObject(root.run).id ? root.run : null,
    attempt: asObject(root.attempt).id ? root.attempt : null,
    userMessage: asObject(root.userMessage).id ? root.userMessage : null,
  };
}

export {
  getAgentSessionMessageActionFromApiResponse,
  getAgentSessionMessagesFromApiResponse,
};
