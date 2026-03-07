'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  buildRustDaemonSupervisorPaths,
  buildRustDaemonSupervisorState,
} = require('../rust-daemon-supervisor.service');

test('buildRustDaemonSupervisorPaths derives stable local supervisor paths', () => {
  const paths = buildRustDaemonSupervisorPaths({
    cwd: '/tmp/auto-researcher',
    env: {},
  });

  assert.deepEqual(paths, {
    dataDir: path.join('/tmp/auto-researcher', 'backend', 'data', 'researchops-rust-daemon'),
    pidFile: path.join('/tmp/auto-researcher', 'backend', 'data', 'researchops-rust-daemon', 'rust-daemon.pid'),
    stateFile: path.join('/tmp/auto-researcher', 'backend', 'data', 'researchops-rust-daemon', 'rust-daemon-state.json'),
    logFile: path.join('/tmp/auto-researcher', 'backend', 'data', 'researchops-rust-daemon', 'rust-daemon.log'),
  });
});

test('buildRustDaemonSupervisorState reports unmanaged mode when no pid/state files exist', () => {
  const state = buildRustDaemonSupervisorState({
    cwd: '/tmp/auto-researcher',
    env: {},
    fsImpl: {
      readFileSync() {
        throw new Error('ENOENT');
      },
    },
  });

  assert.equal(state.mode, 'unmanaged');
  assert.equal(state.running, false);
  assert.equal(state.pid, null);
  assert.equal(state.desiredState, 'stopped');
  assert.equal(state.startedAt, null);
  assert.equal(state.transport, null);
  assert.equal(state.command, null);
});

test('buildRustDaemonSupervisorState reports managed mode when pid file points at current process', () => {
  const currentPid = process.pid;
  const state = buildRustDaemonSupervisorState({
    cwd: '/tmp/auto-researcher',
    env: {},
    fsImpl: {
      readFileSync(filePath) {
        if (String(filePath).endsWith('rust-daemon.pid')) return String(currentPid);
        if (String(filePath).endsWith('rust-daemon-state.json')) {
          return JSON.stringify({
            startedAt: '2026-03-07T12:00:00.000Z',
            transport: 'unix',
            command: 'npm --prefix backend run researchops:rust-daemon',
          });
        }
        throw new Error('ENOENT');
      },
    },
  });

  assert.equal(state.mode, 'managed');
  assert.equal(state.running, true);
  assert.equal(state.pid, currentPid);
  assert.equal(state.desiredState, 'running');
  assert.equal(state.startedAt, '2026-03-07T12:00:00.000Z');
  assert.equal(state.transport, 'unix');
  assert.equal(state.command, 'npm --prefix backend run researchops:rust-daemon');
});

test('buildRustDaemonSupervisorState keeps managed mode when desired state is running but process is down', () => {
  const state = buildRustDaemonSupervisorState({
    cwd: '/tmp/auto-researcher',
    env: {},
    fsImpl: {
      readFileSync(filePath) {
        if (String(filePath).endsWith('rust-daemon.pid')) return '999999';
        if (String(filePath).endsWith('rust-daemon-state.json')) {
          return JSON.stringify({
            desiredState: 'running',
            status: 'stopped',
          });
        }
        throw new Error('ENOENT');
      },
    },
  });

  assert.equal(state.mode, 'managed');
  assert.equal(state.running, false);
  assert.equal(state.desiredState, 'running');
});
