'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResourcePoolPayload,
  normalizeResourcePoolServer,
} = require('../resource-pool-payload.service');

test('normalizeResourcePoolServer exposes execution summary for a server row', () => {
  const server = normalizeResourcePoolServer({
    serverId: 'srv_1',
    hostname: 'gpu-box',
    status: 'online',
    registration: 'daemon',
    concurrencyLimit: 2,
    queuedRuns: 3,
    activeRuns: 1,
    runnerProcesses: 1,
    resources: {
      gpu: { total: 2, available: 1 },
      cpuMemoryGb: { total: 64, available: 40 },
    },
  });

  assert.equal(server.status, 'ONLINE');
  assert.equal(server.execution.serverId, 'srv_1');
  assert.equal(server.execution.backend, 'local');
  assert.equal(server.execution.runtimeClass, '');
  assert.deepEqual(server.execution.resources, {
    gpu: { total: 2, available: 1 },
    cpuMemoryGb: { total: 64, available: 40 },
  });
});

test('buildResourcePoolPayload normalizes aggregate and server rows', () => {
  const payload = buildResourcePoolPayload({
    aggregate: {
      gpuTotal: 2,
      gpuAvailable: 1,
      cpuMemoryTotalGb: 64,
      cpuMemoryAvailableGb: 40,
      queueDepth: 3,
      activeRuns: 1,
      onlineServers: 1,
      offlineServers: 0,
      drainingServers: 0,
      unregisteredServers: 0,
    },
    servers: [
      {
        serverId: 'srv_1',
        hostname: 'gpu-box',
        status: 'online',
        registration: 'daemon',
        concurrencyLimit: 2,
        queuedRuns: 3,
        activeRuns: 1,
        runnerProcesses: 1,
        resources: {
          gpu: { total: 2, available: 1 },
          cpuMemoryGb: { total: 64, available: 40 },
        },
      },
    ],
    dispatcher: { enabled: true },
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.aggregate.gpuTotal, 2);
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.equal(payload.servers.length, 1);
  assert.equal(payload.servers[0].status, 'ONLINE');
  assert.equal(payload.servers[0].execution.serverId, 'srv_1');
});
