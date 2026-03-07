'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSchedulerLeasePayload,
  buildSchedulerRecoveryPayload,
  buildSchedulerStatusPayload,
} = require('../scheduler-payload.service');

test('buildSchedulerLeasePayload exposes leased run semantics and follow-up actions', () => {
  const payload = buildSchedulerLeasePayload({
    mode: 'lease-next',
    serverId: 'srv_local',
    result: {
      leased: true,
      run: {
        id: 'run_1',
        projectId: 'proj_1',
        status: 'PROVISIONING',
      },
    },
  });

  assert.equal(payload.mode, 'lease-next');
  assert.equal(payload.serverId, 'srv_local');
  assert.equal(payload.leased, true);
  assert.equal(payload.run.id, 'run_1');
  assert.equal(payload.attempt.runId, 'run_1');
  assert.deepEqual(payload.actions.leaseNext, {
    method: 'POST',
    path: '/researchops/scheduler/lease-next',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});

test('buildSchedulerRecoveryPayload exposes filters and dispatcher follow-up actions', () => {
  const payload = buildSchedulerRecoveryPayload({
    serverId: 'srv_local',
    minutesStale: 30,
    dryRun: true,
    result: {
      recovered: 2,
      items: [
        { runId: 'run_1', status: 'FAILED' },
      ],
      terminatedLocalProcesses: 1,
    },
  });

  assert.equal(payload.filters.serverId, 'srv_local');
  assert.equal(payload.filters.minutesStale, 30);
  assert.equal(payload.filters.dryRun, true);
  assert.equal(payload.recovered, 2);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.terminatedLocalProcesses, 1);
  assert.deepEqual(payload.actions.recoverStale, {
    method: 'POST',
    path: '/researchops/scheduler/recover-stale',
  });
});

test('buildSchedulerStatusPayload exposes scheduler status actions', () => {
  const payload = buildSchedulerStatusPayload({
    dispatcher: {
      enabled: true,
      lastTickAt: '2026-03-06T12:00:00.000Z',
    },
    runner: {
      running: [{ runId: 'run_1' }],
    },
    refreshedAt: '2026-03-06T12:01:00.000Z',
  });

  assert.equal(payload.dispatcher.enabled, true);
  assert.equal(payload.runner.running.length, 1);
  assert.equal(payload.refreshedAt, '2026-03-06T12:01:00.000Z');
  assert.deepEqual(payload.actions.dispatcherStatus, {
    method: 'GET',
    path: '/researchops/scheduler/dispatcher/status',
  });
  assert.deepEqual(payload.actions.leaseAndExecute, {
    method: 'POST',
    path: '/researchops/scheduler/lease-and-execute',
  });
});
