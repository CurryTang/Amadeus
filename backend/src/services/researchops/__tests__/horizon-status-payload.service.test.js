'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHorizonStatusPayload } = require('../horizon-status-payload.service');

test('buildHorizonStatusPayload preserves status roots and exposes follow-up actions', () => {
  const payload = buildHorizonStatusPayload({
    runId: 'run_1',
    status: 'running',
    message: 'still running',
    lastCheck: '2026-03-06T12:00:00.000Z',
    nextCheck: '2026-03-06T12:05:00.000Z',
    wakeups: 2,
    tmuxAlive: true,
    recentLog: 'tail output',
    session: 'hz_run_1',
    serverId: 'srv_1',
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.status, 'running');
  assert.equal(payload.message, 'still running');
  assert.equal(payload.wakeups, 2);
  assert.equal(payload.tmuxAlive, true);
  assert.equal(payload.recentLog, 'tail output');
  assert.equal(payload.session, 'hz_run_1');
  assert.equal(payload.serverId, 'srv_1');
  assert.deepEqual(payload.actions.status, {
    method: 'GET',
    path: '/researchops/runs/run_1/horizon-status',
  });
  assert.deepEqual(payload.actions.cancel, {
    method: 'POST',
    path: '/researchops/runs/run_1/horizon-cancel',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});
