const crypto = require('crypto');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function classifyFailureText(text = '') {
  const value = cleanString(text).toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('out of memory') || value.includes('cuda oom') || value.includes('oom')) return 'oom';
  if (value.includes('nan') || value.includes('not a number')) return 'nan';
  if (value.includes('timeout') || value.includes('timed out')) return 'timeout';
  if (value.includes('ddp') && value.includes('hang')) return 'ddp_hang';
  if (value.includes('permission denied') || value.includes('publickey')) return 'ssh_auth';
  if (value.includes('module not found') || value.includes('cannot find module')) return 'import_error';
  if (value.includes('assertionerror') || value.includes('assert failed')) return 'assertion';
  return 'runtime_error';
}

function normalizeFailureSignature({
  run = null,
  node = null,
  state = null,
} = {}) {
  const candidate = [
    cleanString(run?.lastMessage),
    cleanString(run?.metadata?.failureMessage),
    cleanString(state?.lastError),
  ].find(Boolean) || '';

  const failureType = classifyFailureText(candidate);
  const tokens = candidate
    .toLowerCase()
    .replace(/[^a-z0-9_\s:/.-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 24)
    .join(' ');

  const stableSource = JSON.stringify({
    nodeId: cleanString(node?.id) || cleanString(run?.metadata?.nodeId),
    type: failureType,
    tokens,
  });

  return {
    type: failureType,
    message: candidate,
    tokens,
    signature: crypto.createHash('sha1').update(stableSource).digest('hex'),
  };
}

module.exports = {
  classifyFailureText,
  normalizeFailureSignature,
};
