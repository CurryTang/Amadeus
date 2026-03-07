'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { buildRustDaemonLaunchSpec } = require('./rust-daemon-launcher.service');
const { buildRustDaemonSupervisorPaths, buildRustDaemonSupervisorState } = require('./rust-daemon-supervisor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildCommandString(spec = {}) {
  const args = Array.isArray(spec.args) ? spec.args : [];
  return [spec.command, ...args].map((item) => cleanString(item)).filter(Boolean).join(' ');
}

function writeSupervisorState(paths, payload, fsImpl = fs) {
  fsImpl.mkdirSync(paths.dataDir, { recursive: true });
  fsImpl.writeFileSync(paths.stateFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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
  writeSupervisorState(paths, {
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
  const priorState = (() => {
    try {
      return JSON.parse(fsImpl.readFileSync(paths.stateFile, 'utf8'));
    } catch (_) {
      return {};
    }
  })();
  if (!supervisor.pid) {
    writeSupervisorState(paths, {
      ...priorState,
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
  writeSupervisorState(paths, {
    ...priorState,
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

module.exports = {
  buildCommandString,
  startRustDaemonSupervisor,
  stopRustDaemonSupervisor,
  restartRustDaemonSupervisor,
};
