'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDaemonHeartbeatPayload,
  buildDaemonListPayload,
  buildDaemonRegistrationPayload,
  normalizeDaemon,
} = require('../daemon-payload.service');

test('normalizeDaemon uppercases status and exposes a stable execution summary', () => {
  const daemon = normalizeDaemon({
    id: 'srv_1',
    hostname: 'client-host',
    status: 'online',
    labels: { role: 'client-device' },
    concurrencyLimit: 3,
    capacity: {
      gpu: { total: 1, available: 1 },
      cpuMemoryGb: { total: 64, available: 52 },
    },
  });

  assert.equal(daemon.id, 'srv_1');
  assert.equal(daemon.status, 'ONLINE');
  assert.equal(daemon.execution.serverId, 'srv_1');
  assert.equal(daemon.execution.location, 'client');
  assert.equal(daemon.execution.registration, 'daemon');
  assert.equal(daemon.execution.concurrencyLimit, 3);
  assert.deepEqual(daemon.execution.resources, {
    gpu: { total: 1, available: 1 },
    cpuMemoryGb: { total: 64, available: 52 },
  });
});

test('buildDaemonRegistrationPayload keeps legacy top-level fields while exposing normalized daemon', () => {
  const payload = buildDaemonRegistrationPayload({
    daemon: {
      id: 'srv_2',
      hostname: 'builder-host',
      status: 'online',
      labels: { role: 'embedded-runner' },
      heartbeatAt: '2026-03-06T12:00:00.000Z',
    },
  });

  assert.equal(payload.serverId, 'srv_2');
  assert.equal(payload.hostname, 'builder-host');
  assert.equal(payload.status, 'ONLINE');
  assert.equal(payload.daemon.id, 'srv_2');
  assert.equal(payload.daemon.execution.location, 'local');
});

test('buildDaemonListPayload normalizes each daemon item', () => {
  const payload = buildDaemonListPayload({
    items: [
      {
        id: 'srv_1',
        hostname: 'client-host',
        status: 'online',
        labels: { role: 'client-device' },
      },
    ],
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'ONLINE');
  assert.equal(payload.items[0].execution.location, 'client');
});

test('buildDaemonHeartbeatPayload mirrors registration payload shape', () => {
  const payload = buildDaemonHeartbeatPayload({
    daemon: {
      id: 'srv_3',
      hostname: 'client-host',
      status: 'online',
      labels: { role: 'client-device' },
      heartbeatAt: '2026-03-06T12:01:00.000Z',
    },
  });

  assert.equal(payload.serverId, 'srv_3');
  assert.equal(payload.daemon.heartbeatAt, '2026-03-06T12:01:00.000Z');
});
