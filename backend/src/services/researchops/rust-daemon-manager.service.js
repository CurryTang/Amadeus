'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildRustDaemonLaunchSpec } = require('./rust-daemon-launcher.service');
const {
  buildRustDaemonSupervisorPaths,
  buildRustDaemonSupervisorState,
  normalizeDesiredState,
} = require('./rust-daemon-supervisor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildCommandString(spec = {}) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  return [spec.command, ...args].map((item) => cleanString(item)).filter(Boolean).join(' ');
}

function readSupervisorStateFile(paths, fsImpl = fs) {
  try {
    return JSON.parse(fsImpl.readFileSync(paths.stateFile, 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSupervisorState(paths, payload, fsImpl = fs) {
  fsImpl.mkdirSync(paths.dataDir, { recursive: true });
  fsImpl.writeFileSync(paths.stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function persistSupervisorState(paths, nextPatch, fsImpl = fs) {
  const prior = readSupervisorStateFile(paths, fsImpl);
  const merged = {
    ...prior,
    ...nextPatch,
    desiredState: normalizeDesiredState(nextPatch?.desiredState ?? prior?.desiredState),
  };
  writeSupervisorState(paths, merged, fsImpl);
  return merged;
}

function startRustDaemonSupervisor({
  cwd = process.cwd(),
  env = process.env,
  fsImpl = fs,
  spawnImpl = spawn,
  now = () => new Date().toISOString(),
} = {}) {
  const supervisor = buildRustDaemonSupervisorState({ cwd, env, fsImpl });
  if (supervisor.running && supervisor.pid) {
    const paths = buildRustDaemonSupervisorPaths({ cwd, env });
    persistSupervisorState(paths, {
      desiredState: 'running',
      status: 'running',
      pid: supervisor.pid,
    }, fsImpl);
    return {
      action: 'start',
      status: 'already_running',
      pid: supervisor.pid,
      supervisor,
    };
  }

  const spec = buildRustDaemonLaunchSpec(env);
  const paths = buildRustDaemonSupervisorPaths({ cwd, env });
  fsImpl.mkdirSync(paths.dataDir, { recursive: true });
  const logFd = fsImpl.openSync(paths.logFile, 'a');
  const child = spawnImpl(spec.command, spec.args, {
    cwd: path.join(cwd, 'backend'),
    env: spec.env,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  });
  if (typeof child.unref === 'function') child.unref();
  if (typeof fsImpl.closeSync === 'function') fsImpl.closeSync(logFd);
  const pid = Number(child.pid) || null;
  if (pid) {
    fsImpl.writeFileSync(paths.pidFile, `${pid}\n`, 'utf8');
  }
  persistSupervisorState(paths, {
    desiredState: 'running',
    status: 'running',
    startedAt: now(),
    transport: spec.transport,
    command: buildCommandString(spec),
    pid,
  }, fsImpl);

  return {
    action: 'start',
    status: 'started',
    pid,
    supervisor: buildRustDaemonSupervisorState({ cwd, env, fsImpl }),
  };
}

function stopRustDaemonSupervisor({
  cwd = process.cwd(),
  env = process.env,
  fsImpl = fs,
  killImpl = (pid, signal) => process.kill(pid, signal),
  now = () => new Date().toISOString(),
} = {}) {
  const supervisor = buildRustDaemonSupervisorState({ cwd, env, fsImpl });
  const paths = buildRustDaemonSupervisorPaths({ cwd, env });
  if (!supervisor.pid) {
    persistSupervisorState(paths, {
      desiredState: 'stopped',
      status: 'stopped',
      stoppedAt: now(),
      pid: null,
    }, fsImpl);
    return {
      action: 'stop',
      status: 'not_running',
      pid: null,
      supervisor: buildRustDaemonSupervisorState({ cwd, env, fsImpl }),
    };
  }

  killImpl(supervisor.pid, 'SIGTERM');
  fsImpl.writeFileSync(paths.pidFile, '\n', 'utf8');
  persistSupervisorState(paths, {
    desiredState: 'stopped',
    status: 'stopped',
    stoppedAt: now(),
    lastPid: supervisor.pid,
    pid: null,
  }, fsImpl);
  return {
    action: 'stop',
    status: 'stopped',
    pid: supervisor.pid,
    supervisor: buildRustDaemonSupervisorState({ cwd, env, fsImpl }),
  };
}

function restartRustDaemonSupervisor(options = {}) {
  const stopResult = stopRustDaemonSupervisor(options);
  const startResult = startRustDaemonSupervisor(options);
  return {
    action: 'restart',
    status: 'restarted',
    previous: stopResult,
    current: startResult,
    pid: startResult.pid,
    supervisor: startResult.supervisor,
  };
}

function enableRustDaemonSupervisor(options = {}) {
  const { cwd = process.cwd(), env = process.env, fsImpl = fs, now = () => new Date().toISOString() } = options;
  const paths = buildRustDaemonSupervisorPaths({ cwd, env });
  persistSupervisorState(paths, {
    desiredState: 'running',
    updatedAt: now(),
  }, fsImpl);
  const startResult = startRustDaemonSupervisor({ ...options, cwd, env, fsImpl, now });
  return {
    action: 'enable_managed',
    status: startResult.status === 'already_running' ? 'already_enabled' : 'enabled',
    pid: startResult.pid,
    supervisor: startResult.supervisor,
  };
}

function disableRustDaemonSupervisor(options = {}) {
  const { cwd = process.cwd(), env = process.env, fsImpl = fs, now = () => new Date().toISOString() } = options;
  const paths = buildRustDaemonSupervisorPaths({ cwd, env });
  persistSupervisorState(paths, {
    desiredState: 'stopped',
    updatedAt: now(),
  }, fsImpl);
  const stopResult = stopRustDaemonSupervisor({ ...options, cwd, env, fsImpl, now });
  return {
    action: 'disable_managed',
    status: 'disabled',
    pid: stopResult.pid,
    supervisor: stopResult.supervisor,
  };
}

function reconcileRustDaemonSupervisor(options = {}) {
  const { cwd = process.cwd(), env = process.env, fsImpl = fs, now = () => new Date().toISOString() } = options;
  const supervisor = buildRustDaemonSupervisorState({ cwd, env, fsImpl });
  if (supervisor.desiredState === 'running' && !supervisor.running) {
    const startResult = startRustDaemonSupervisor({ ...options, cwd, env, fsImpl, now });
    return {
      action: 'reconcile_managed',
      status: startResult.status === 'already_running' ? 'in_sync' : startResult.status,
      pid: startResult.pid,
      supervisor: startResult.supervisor,
    };
  }
  if (supervisor.desiredState === 'stopped' && supervisor.running) {
    const stopResult = stopRustDaemonSupervisor({ ...options, cwd, env, fsImpl, now });
    return {
      action: 'reconcile_managed',
      status: stopResult.status,
      pid: stopResult.pid,
      supervisor: stopResult.supervisor,
    };
  }
  return {
    action: 'reconcile_managed',
    status: 'in_sync',
    pid: supervisor.pid,
    supervisor,
  };
}

module.exports = {
  buildCommandString,
  enableRustDaemonSupervisor,
  disableRustDaemonSupervisor,
  reconcileRustDaemonSupervisor,
  startRustDaemonSupervisor,
  stopRustDaemonSupervisor,
  restartRustDaemonSupervisor,
};
