function cleanString(value) {
  return String(value || '').trim();
}

function buildAgentSessionListItem(session = null) {
  const title = cleanString(session?.title) || cleanString(session?.id);
  const status = cleanString(session?.status).toUpperCase() || 'IDLE';
  return {
    title,
    statusLabel: status === 'RUNNING' ? 'Running' : status,
    statusTone: status.toLowerCase() || 'idle',
  };
}

function buildAgentSessionHeaderSummary({
  session = null,
  activeRun = null,
  activeAttemptLabel = '',
} = {}) {
  const title = cleanString(session?.title) || cleanString(session?.id) || 'No session selected';
  const sessionStatus = cleanString(session?.status).toUpperCase() || 'IDLE';
  const runStatus = cleanString(activeRun?.status).toUpperCase();
  const isRunning = ['QUEUED', 'PROVISIONING', 'RUNNING'].includes(runStatus) || sessionStatus === 'RUNNING';
  const statusTone = (runStatus || sessionStatus || 'IDLE').toLowerCase();
  const statusLabel = isRunning
    ? `Running${runStatus ? ` (${runStatus})` : ''}`
    : (sessionStatus || 'IDLE');

  return {
    title,
    statusTone,
    statusLabel,
    runLabel: cleanString(activeRun?.id),
    attemptLabel: cleanString(activeAttemptLabel),
  };
}

export {
  buildAgentSessionHeaderSummary,
  buildAgentSessionListItem,
};
