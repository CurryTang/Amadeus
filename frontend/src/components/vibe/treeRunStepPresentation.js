function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pluralize(count = 0, singular = '', plural = '') {
  const value = Number(count) || 0;
  return value === 1 ? `1 ${singular}` : `${value} ${plural || `${singular}s`}`;
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
    const execution = payload?.runPreview?.execution && typeof payload.runPreview.execution === 'object'
      ? payload.runPreview.execution
      : {};
    const contract = payload?.runPreview?.contract && typeof payload.runPreview.contract === 'object'
      ? payload.runPreview.contract
      : {};
    const workspaceSnapshot = payload?.runPreview?.workspaceSnapshot && typeof payload.runPreview.workspaceSnapshot === 'object'
      ? payload.runPreview.workspaceSnapshot
      : {};
    const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
      ? workspaceSnapshot.localSnapshot
      : {};
    const runtimeBits = [cleanString(execution.backend), cleanString(execution.runtimeClass)].filter(Boolean);
    const requiredArtifacts = Array.isArray(contract.requiredArtifacts)
      ? contract.requiredArtifacts.filter((item) => cleanString(item))
      : [];
    const hasSnapshot = Boolean(cleanString(localSnapshot.kind) || cleanString(localSnapshot.note));
    let message = `Preflight ready for ${nodeId} with ${pluralize(commands, 'command')}.`;
    if (runtimeBits.length > 0 || requiredArtifacts.length > 0 || hasSnapshot) {
      message = `Preflight ready for ${nodeId} with ${pluralize(commands, 'command')}`;
      if (runtimeBits.length > 0) {
        message += ` on ${runtimeBits.join('/')}`;
      }
      if (requiredArtifacts.length > 0) {
        message += `; ${pluralize(requiredArtifacts.length, 'required artifact')}`;
      }
      if (hasSnapshot) {
        message += '; snapshot-backed';
      }
      message += '.';
    }
    return message;
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
