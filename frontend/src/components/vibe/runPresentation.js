function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getRunSourceLabel(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const sourceType = cleanString(metadata.sourceType).toLowerCase();
  if (sourceType === 'tree' || cleanString(metadata.treeNodeId)) return 'Tree';
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
      return {
        id: cleanString(run?.id),
        status: cleanString(run?.status).toUpperCase() || 'UNKNOWN',
        runType: cleanString(run?.runType).toUpperCase() || 'AGENT',
        runTypeLabel: cleanString(run?.runType).toUpperCase() === 'EXPERIMENT' ? 'Experiment' : 'Implement',
        sourceLabel: getRunSourceLabel(run),
        title: getRunTitle(run),
        linkedNodeTitle: cleanString(metadata.treeNodeTitle),
        snippet: cleanString(run?.resultSnippet),
        timestamp: formatTimestamp(run?.createdAt),
        raw: run,
      };
    });
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
  getRunSourceLabel,
};
