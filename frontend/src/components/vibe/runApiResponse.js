function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function getRunFromApiResponse(payload = null) {
  const root = asObject(payload);
  const run = asObject(root.run);
  if (run.id) return run;
  const nestedRun = asObject(asObject(root.data).run);
  if (nestedRun.id) return nestedRun;
  return null;
}

function getRunIdFromApiResponse(payload = null) {
  const run = getRunFromApiResponse(payload);
  if (run?.id) return String(run.id);
  const attempt = asObject(asObject(payload).attempt);
  if (attempt.id) return String(attempt.id);
  return '';
}

export {
  getRunFromApiResponse,
  getRunIdFromApiResponse,
};
