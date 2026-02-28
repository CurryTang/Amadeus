const DEFAULT_GRACE_MS = 5000;
const POLL_INTERVAL_MS = 120;

function normalizePid(value) {
  const pid = Number(value);
  if (!Number.isFinite(pid)) return null;
  const intPid = Math.trunc(pid);
  return intPid > 0 ? intPid : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processExists(pid) {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return false;
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    return false;
  }
}

function tryKillPid(pid, signal = 'SIGTERM') {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return false;
  try {
    process.kill(normalizedPid, signal);
    return true;
  } catch (_) {
    return false;
  }
}

function tryKillProcessGroup(pid, signal = 'SIGTERM') {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return false;
  if (process.platform === 'win32') {
    return tryKillPid(normalizedPid, signal);
  }
  try {
    process.kill(-normalizedPid, signal);
    return true;
  } catch (_) {
    return false;
  }
}

async function waitForExit(pid, {
  timeoutMs = DEFAULT_GRACE_MS,
  pollIntervalMs = POLL_INTERVAL_MS,
} = {}) {
  const normalizedPid = normalizePid(pid);
  if (!normalizedPid) return true;
  const deadline = Date.now() + Math.max(Number(timeoutMs) || 0, 0);
  while (Date.now() <= deadline) {
    if (!processExists(normalizedPid)) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(Math.max(Number(pollIntervalMs) || POLL_INTERVAL_MS, 25));
  }
  return !processExists(normalizedPid);
}

async function terminateProcessTree({
  pid = null,
  child = null,
  detached = false,
  graceMs = DEFAULT_GRACE_MS,
} = {}) {
  const normalizedPid = normalizePid(pid) || normalizePid(child?.pid);
  let termSent = false;
  let killSent = false;

  if (normalizedPid) {
    termSent = detached
      ? tryKillProcessGroup(normalizedPid, 'SIGTERM')
      : tryKillPid(normalizedPid, 'SIGTERM');
  }
  if (child && typeof child.kill === 'function') {
    try {
      child.kill('SIGTERM');
      termSent = true;
    } catch (_) {
      // ignore
    }
  }

  const exitedGracefully = normalizedPid
    ? await waitForExit(normalizedPid, { timeoutMs: graceMs })
    : true;

  let alive = normalizedPid ? processExists(normalizedPid) : false;
  if (!exitedGracefully && normalizedPid) {
    killSent = detached
      ? tryKillProcessGroup(normalizedPid, 'SIGKILL')
      : tryKillPid(normalizedPid, 'SIGKILL');
    if (child && typeof child.kill === 'function') {
      try {
        child.kill('SIGKILL');
        killSent = true;
      } catch (_) {
        // ignore
      }
    }
    await waitForExit(normalizedPid, { timeoutMs: 1500 });
    alive = processExists(normalizedPid);
  }

  return {
    pid: normalizedPid,
    detached: !!detached,
    termSent,
    killSent,
    alive,
  };
}

module.exports = {
  normalizePid,
  processExists,
  terminateProcessTree,
};
