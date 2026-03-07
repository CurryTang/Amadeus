'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  enableRustDaemonSupervisor,
  disableRustDaemonSupervisor,
  reconcileRustDaemonSupervisor,
  startRustDaemonSupervisor,
  stopRustDaemonSupervisor,
  restartRustDaemonSupervisor,
} = require('../rust-daemon-manager.service');

function createFsStub({ pid = null, state = null } = {}) {
  const files = new Map();
  if (pid !== null) files.set('/tmp/auto-researcher/backend/data/researchops-rust-daemon/rust-daemon.pid', `${pid}\n`);
  if (state !== null) files.set('/tmp/auto-researcher/backend/data/researchops-rust-daemon/rust-daemon-state.json', `${JSON.stringify(state)}\n`);
  return {
    files,
    mkdirSync() {},
    openSync() { return 17; },
    closeSync() {},
    writeFileSync(filePath, content) { files.set(String(filePath), String(content)); },
    readFileSync(filePath) {
      const value = files.get(String(filePath));
      if (value == null) throw new Error('ENOENT');
      return value;
    },
  };
}

test('startRustDaemonSupervisor spawns detached backend process and writes supervisor files', () => {
  const fsStub = createFsStub();
  const spawns = [];
  const result = startRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    env: {
      RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    },
    fsImpl: fsStub,
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return { pid: 43210, unref() {} };
    },
    now: () => '2026-03-07T13:00:00.000Z',
  });

  assert.equal(result.status, 'started');
  assert.equal(result.pid, 43210);
  assert.equal(result.supervisor.desiredState, 'running');
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0].options.cwd, '/tmp/auto-researcher/backend');
  assert.equal(spawns[0].options.detached, true);
  assert.match(fsStub.files.get('/tmp/auto-researcher/backend/data/researchops-rust-daemon/rust-daemon.pid') || '', /43210/);
  assert.match(fsStub.files.get('/tmp/auto-researcher/backend/data/researchops-rust-daemon/rust-daemon-state.json') || '', /2026-03-07T13:00:00.000Z/);
});

test('stopRustDaemonSupervisor kills current pid and preserves state files', () => {
  const fsStub = createFsStub({
    pid: process.pid,
    state: {
      status: 'running',
      startedAt: '2026-03-07T12:00:00.000Z',
    },
  });
  const kills = [];
  const result = stopRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    fsImpl: fsStub,
    killImpl(pid, signal) {
      kills.push({ pid, signal });
    },
    now: () => '2026-03-07T13:05:00.000Z',
  });

  assert.equal(result.status, 'stopped');
  assert.equal(result.supervisor.desiredState, 'stopped');
  assert.deepEqual(kills, [{ pid: process.pid, signal: 'SIGTERM' }]);
  assert.match(fsStub.files.get('/tmp/auto-researcher/backend/data/researchops-rust-daemon/rust-daemon-state.json') || '', /2026-03-07T13:05:00.000Z/);
});

test('restartRustDaemonSupervisor stops prior pid and starts a new detached process', () => {
  const fsStub = createFsStub({
    pid: process.pid,
    state: {
      status: 'running',
      startedAt: '2026-03-07T12:00:00.000Z',
    },
  });
  const kills = [];
  const spawns = [];
  const result = restartRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    env: {
      RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    },
    fsImpl: fsStub,
    killImpl(pid, signal) {
      kills.push({ pid, signal });
    },
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return { pid: 54321, unref() {} };
    },
    now: () => '2026-03-07T13:10:00.000Z',
  });

  assert.equal(result.status, 'restarted');
  assert.deepEqual(kills, [{ pid: process.pid, signal: 'SIGTERM' }]);
  assert.equal(spawns.length, 1);
  assert.equal(result.pid, 54321);
  assert.equal(result.supervisor.desiredState, 'running');
});

test('enableRustDaemonSupervisor marks desired state running and starts when needed', () => {
  const fsStub = createFsStub();
  const spawns = [];
  const result = enableRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    env: {
      RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    },
    fsImpl: fsStub,
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return { pid: 65432, unref() {} };
    },
    now: () => '2026-03-07T13:15:00.000Z',
  });

  assert.equal(result.action, 'enable_managed');
  assert.equal(result.status, 'enabled');
  assert.equal(result.supervisor.desiredState, 'running');
  assert.equal(spawns.length, 1);
});

test('disableRustDaemonSupervisor marks desired state stopped and stops current process', () => {
  const fsStub = createFsStub({
    pid: process.pid,
    state: {
      desiredState: 'running',
      status: 'running',
      startedAt: '2026-03-07T12:00:00.000Z',
    },
  });
  const kills = [];
  const result = disableRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    fsImpl: fsStub,
    killImpl(pid, signal) {
      kills.push({ pid, signal });
    },
    now: () => '2026-03-07T13:20:00.000Z',
  });

  assert.equal(result.action, 'disable_managed');
  assert.equal(result.status, 'disabled');
  assert.equal(result.supervisor.desiredState, 'stopped');
  assert.deepEqual(kills, [{ pid: process.pid, signal: 'SIGTERM' }]);
});

test('reconcileRustDaemonSupervisor starts process when desired state is running and process is down', () => {
  const fsStub = createFsStub({
    state: {
      desiredState: 'running',
      status: 'stopped',
    },
  });
  const spawns = [];
  const result = reconcileRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    env: {
      RESEARCHOPS_API_BASE_URL: 'https://example.com/api',
    },
    fsImpl: fsStub,
    spawnImpl(command, args, options) {
      spawns.push({ command, args, options });
      return { pid: 76543, unref() {} };
    },
    now: () => '2026-03-07T13:25:00.000Z',
  });

  assert.equal(result.action, 'reconcile_managed');
  assert.equal(result.status, 'started');
  assert.equal(result.supervisor.desiredState, 'running');
  assert.equal(spawns.length, 1);
});

test('reconcileRustDaemonSupervisor stops process when desired state is stopped and process is running', () => {
  const fsStub = createFsStub({
    pid: process.pid,
    state: {
      desiredState: 'stopped',
      status: 'running',
    },
  });
  const kills = [];
  const result = reconcileRustDaemonSupervisor({
    cwd: '/tmp/auto-researcher',
    fsImpl: fsStub,
    killImpl(pid, signal) {
      kills.push({ pid, signal });
    },
    now: () => '2026-03-07T13:30:00.000Z',
  });

  assert.equal(result.action, 'reconcile_managed');
  assert.equal(result.status, 'stopped');
  assert.equal(result.supervisor.desiredState, 'stopped');
  assert.deepEqual(kills, [{ pid: process.pid, signal: 'SIGTERM' }]);
});
