'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRunnerRunningPayload,
  buildAgentCapacityPayload,
} = require('../runner-status-payload.service');

test('buildRunnerRunningPayload preserves running items and adds follow-up actions', () => {
  const payload = buildRunnerRunningPayload({
    items: [
      {
        runId: 'run_1',
        serverId: 'local-default',
        pid: 1234,
      },
    ],
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].runId, 'run_1');
  assert.deepEqual(payload.actions.running, {
    method: 'GET',
    path: '/researchops/runner/running',
  });
  assert.deepEqual(payload.actions.dispatcherStatus, {
    method: 'GET',
    path: '/researchops/scheduler/dispatcher/status',
  });
});

test('buildAgentCapacityPayload preserves totals/providers and adds follow-up actions', () => {
  const payload = buildAgentCapacityPayload({
    totals: {
      activeSessions: 2,
      maxConcurrent: 8,
      availableSessions: 6,
    },
    providers: [
      {
        provider: 'codex_cli',
        activeSessions: 2,
        maxConcurrent: 4,
        availableSessions: 2,
      },
    ],
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.totals.activeSessions, 2);
  assert.equal(payload.providers.length, 1);
  assert.equal(payload.providers[0].provider, 'codex_cli');
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.agentCapacity, {
    method: 'GET',
    path: '/researchops/cluster/agent-capacity',
  });
  assert.deepEqual(payload.actions.running, {
    method: 'GET',
    path: '/researchops/runner/running',
  });
});
