function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getContextPackViewForRun(payload = null, runId = '') {
  const targetRunId = cleanString(runId);
  if (!targetRunId) return null;
  const root = asObject(payload);
  const view = asObject(root.view);
  if (!view || !Object.keys(view).length) return null;
  const pack = asObject(root.pack);
  const payloadRunId = cleanString(pack.runId) || cleanString(view.runId);
  if (payloadRunId !== targetRunId) return null;
  return view;
}

export {
  getContextPackViewForRun,
};
