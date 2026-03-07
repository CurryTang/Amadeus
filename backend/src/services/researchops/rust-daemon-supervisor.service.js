'use strict';

const fs = require('node:fs');
const path = require('node:path');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHealthState(value) {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'healthy') return 'healthy';
  if (normalized === 'degraded') return 'degraded';
  if (normalized === 'reconciling') return 'reconciling';
  if (normalized === 'disabled') return 'disabled';
  return null;
}

function normalizeDesiredState(value, fallback = 'stopped') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'running') return 'running';
  if (normalized === 'stopped') return 'stopped';
  return fallback;
}

function buildRustDaemonSupervisorPaths({ cwd = process.cwd(), env = process.env } = {}) {
  const dataDir = cleanString(env?.RESEARCHOPS_RUST_DAEMON_DATA_DIR)
    || path.join(cwd, 'backend', 'data', 'researchops-rust-daemon');
  return {
    dataDir,
    pidFile: path.join(dataDir, 'rust-daemon.pid'),
    stateFile: path.join(dataDir, 'rust-daemon-state.json'),
    logFile: path.join(dataDir, 'rust-daemon.log'),
  };
}

function readJsonFile(filePath, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readPidFile(filePath, fsImpl = fs) {
  try {
    const value = Number.parseInt(fsImpl.readFileSync(filePath, 'utf8'), 10);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch (_) {
    return null;
  }
}

function isProcessRunning(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function buildRustDaemonSupervisorState({ cwd = process.cwd(), env = process.env, fsImpl = fs } = {}) {
  const paths = buildRustDaemonSupervisorPaths({ cwd, env });
  const state = readJsonFile(paths.stateFile, fsImpl) || {};
  const pid = readPidFile(paths.pidFile, fsImpl);
  const running = isProcessRunning(pid);
  const desiredState = normalizeDesiredState(state.desiredState, running ? 'running' : 'stopped');
  const mode = desiredState === 'running' || running ? 'managed' : 'unmanaged';

  return {
    mode,
    running,
    pid,
    desiredState,
    pidFile: paths.pidFile,
    stateFile: paths.stateFile,
    logFile: paths.logFile,
    startedAt: cleanString(state.startedAt) || null,
    transport: cleanString(state.transport) || null,
    command: cleanString(state.command) || null,
    healthState: normalizeHealthState(state.healthState),
    lastFailureReason: cleanString(state.lastFailureReason) || null,
  };
}

module.exports = {
  buildRustDaemonSupervisorPaths,
  buildRustDaemonSupervisorState,
  normalizeHealthState,
  normalizeDesiredState,
};
