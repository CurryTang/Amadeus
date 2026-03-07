function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getRunSourceLabel(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const attempt = run?.attempt && typeof run.attempt === 'object' ? run.attempt : {};
  const sourceType = cleanString(metadata.sourceType).toLowerCase();
  if (sourceType === 'tree' || cleanString(metadata.treeNodeId) || cleanString(attempt.treeNodeId || attempt.nodeId)) return 'Tree';
  if (sourceType === 'todo' || cleanString(metadata.todoId)) return 'TODO';
  if (sourceType === 'custom') return 'Custom';
  return 'Launcher';
}

function getRunTitle(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  return cleanString(metadata.prompt)
    || cleanString(metadata.experimentCommand)
    || cleanString(metadata.command)
    || cleanString(run?.id)
    || 'Untitled run';
}

function formatTimestamp(createdAt = '') {
  const ts = cleanString(createdAt);
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

function getExecutionLabel(run = {}) {
  const execution = run?.execution && typeof run.execution === 'object' ? run.execution : {};
  return cleanString(execution.location) === 'remote' ? 'Remote' : '';
}

function getExecutionRuntimeLabel(run = {}) {
  const execution = run?.execution && typeof run.execution === 'object' ? run.execution : {};
  const parts = [cleanString(execution.backend), cleanString(execution.runtimeClass)].filter(Boolean);
  return parts.join('/');
}

function getSnapshotLabel(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const workspaceSnapshot = run?.workspaceSnapshot && typeof run.workspaceSnapshot === 'object'
    ? run.workspaceSnapshot
    : {};
  const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
    ? workspaceSnapshot.localSnapshot
    : (metadata.localSnapshot && typeof metadata.localSnapshot === 'object' ? metadata.localSnapshot : {});
  return cleanString(localSnapshot.kind) || cleanString(localSnapshot.note) ? 'Snapshot-backed' : '';
}

function getContractLabel(run = {}) {
  const contract = run?.contract && typeof run.contract === 'object' ? run.contract : {};
  return contract.ok === false ? 'Validation failed' : '';
}

function buildRecentRunCards(runs = []) {
  if (!Array.isArray(runs)) return [];
  return [...runs]
    .sort((a, b) => {
      const tsDiff = cleanString(b?.createdAt).localeCompare(cleanString(a?.createdAt));
      if (tsDiff !== 0) return tsDiff;
      return cleanString(b?.id).localeCompare(cleanString(a?.id));
    })
    .map((run) => {
      const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
      const attempt = run?.attempt && typeof run.attempt === 'object' ? run.attempt : {};
      return {
        id: cleanString(run?.id),
        status: cleanString(run?.status).toUpperCase() || 'UNKNOWN',
        runType: cleanString(run?.runType).toUpperCase() || 'AGENT',
        runTypeLabel: cleanString(run?.runType).toUpperCase() === 'EXPERIMENT' ? 'Experiment' : 'Implement',
        sourceLabel: getRunSourceLabel(run),
        title: getRunTitle(run),
        linkedNodeTitle: cleanString(metadata.treeNodeTitle) || cleanString(attempt.treeNodeTitle),
        snippet: cleanString(run?.resultSnippet),
        executionLabel: getExecutionLabel(run),
        executionRuntimeLabel: getExecutionRuntimeLabel(run),
        snapshotLabel: getSnapshotLabel(run),
        contractLabel: getContractLabel(run),
        timestamp: formatTimestamp(run?.createdAt),
        raw: run,
      };
    });
}

function buildRecentRunReviewSummary(runs = []) {
  const items = Array.isArray(runs) ? runs : [];
  let activeCount = 0;
  let attentionCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let contractFailureCount = 0;
  let remoteExecutionCount = 0;
  let snapshotBackedCount = 0;
  items.forEach((run) => {
    const status = cleanString(run?.status).toUpperCase();
    const execution = run?.execution && typeof run.execution === 'object' ? run.execution : {};
    const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
    const workspaceSnapshot = run?.workspaceSnapshot && typeof run.workspaceSnapshot === 'object'
      ? run.workspaceSnapshot
      : {};
    const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
      ? workspaceSnapshot.localSnapshot
      : (metadata.localSnapshot && typeof metadata.localSnapshot === 'object' ? metadata.localSnapshot : {});
    if (['RUNNING', 'QUEUED', 'PENDING'].includes(status)) {
      activeCount += 1;
    } else if (status === 'SUCCEEDED') {
      completedCount += 1;
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      attentionCount += 1;
      if (status === 'FAILED') failedCount += 1;
      if (status === 'CANCELLED') cancelledCount += 1;
    }
    if (run?.contract?.ok === false && !['FAILED', 'CANCELLED'].includes(status)) {
      contractFailureCount += 1;
      attentionCount += 1;
    } else if (run?.contract?.ok === false) {
      contractFailureCount += 1;
    }
    if (cleanString(execution.location) === 'remote' || (cleanString(run?.serverId) && cleanString(run?.serverId) !== 'local-default')) {
      remoteExecutionCount += 1;
    }
    if (cleanString(localSnapshot.kind) || cleanString(localSnapshot.note)) {
      snapshotBackedCount += 1;
    }
  });
  let status = 'idle';
  if (attentionCount > 0) {
    status = 'needs_attention';
  } else if (activeCount > 0) {
    status = 'active';
  } else if (completedCount > 0) {
    status = 'stable';
  }
  return {
    totalCount: items.length,
    activeCount,
    attentionCount,
    completedCount,
    failedCount,
    cancelledCount,
    contractFailureCount,
    remoteExecutionCount,
    snapshotBackedCount,
    status,
  };
}

function filterRunsForSelectedNode(runs = [], selectedNodeId = '') {
  if (!Array.isArray(runs)) return [];
  const targetNodeId = cleanString(selectedNodeId);
  if (!targetNodeId) return runs;
  const filtered = runs.filter((run) => {
    const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
    const attempt = run?.attempt && typeof run.attempt === 'object' ? run.attempt : {};
    return cleanString(metadata.treeNodeId || metadata.nodeId || attempt.treeNodeId || attempt.nodeId) === targetNodeId;
  });
  return filtered.length > 0 ? filtered : runs;
}

function buildContinuationChip(run = {}) {
  const runId = cleanString(run?.id);
  if (!runId) return null;
  return {
    id: runId,
    runId,
    label: `Using run: ${getRunTitle(run)}`,
  };
}

export {
  buildRecentRunReviewSummary,
  buildContinuationChip,
  buildRecentRunCards,
  filterRunsForSelectedNode,
  getRunSourceLabel,
};
