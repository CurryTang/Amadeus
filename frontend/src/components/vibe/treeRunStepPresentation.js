function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTreeRunStepMessage(payload = {}) {
  const mode = cleanString(payload?.mode).toLowerCase();
  const nodeId = cleanString(payload?.nodeId);
  if (mode === 'run') {
    const runId = cleanString(payload?.run?.id);
    return runId ? `Started run ${runId} for ${nodeId}.` : `Started run for ${nodeId}.`;
  }
  if (mode === 'preflight') {
    const commands = Array.isArray(payload?.commands) ? payload.commands.length : 0;
    return `Preflight ready for ${nodeId} with ${commands} commands.`;
  }
  if (mode === 'search') {
    const trials = Array.isArray(payload?.search?.trials) ? payload.search.trials.length : 0;
    return `Queued search for ${nodeId} with ${trials} trials.`;
  }
  return nodeId ? `Tree step submitted for ${nodeId}.` : 'Tree step submitted.';
}

export {
  buildTreeRunStepMessage,
};
