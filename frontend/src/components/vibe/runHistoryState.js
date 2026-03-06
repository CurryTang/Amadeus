function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function matchesRunRemoval(item = {}, { projectId = '', status = '', runId = '' } = {}) {
  if (cleanString(item?.projectId) !== cleanString(projectId)) return false;
  if (cleanString(runId) && cleanString(item?.id) === cleanString(runId)) return true;
  if (cleanString(status) && cleanString(item?.status).toUpperCase() === cleanString(status).toUpperCase()) return true;
  return false;
}

export function removeProjectRunsFromState({
  runs = [],
  runHistoryItems = [],
  projectId = '',
  status = '',
  runId = '',
} = {}) {
  const shouldRemove = (item) => matchesRunRemoval(item, { projectId, status, runId });
  return {
    runs: (Array.isArray(runs) ? runs : []).filter((item) => !shouldRemove(item)),
    runHistoryItems: (Array.isArray(runHistoryItems) ? runHistoryItems : []).filter((item) => !shouldRemove(item)),
  };
}
