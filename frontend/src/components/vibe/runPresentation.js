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
        timestamp: formatTimestamp(run?.createdAt),
        raw: run,
      };
    });
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
  buildContinuationChip,
  buildRecentRunCards,
  filterRunsForSelectedNode,
  getRunSourceLabel,
};
