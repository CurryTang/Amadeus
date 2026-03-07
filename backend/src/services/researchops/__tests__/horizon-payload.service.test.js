'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildHorizonCancelPayload } = require('../horizon-payload.service');

test('buildHorizonCancelPayload preserves session roots while exposing follow-up actions', () => {
  const payload = buildHorizonCancelPayload({
    runId: 'run_1',
    session: 'hz_run_1',
    message: "Killed tmux session 'hz_run_1'",
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.ok, true);
  assert.equal(payload.session, 'hz_run_1');
  assert.equal(payload.message, "Killed tmux session 'hz_run_1'");
  assert.deepEqual(payload.actions.cancel, {
    method: 'POST',
    path: '/researchops/runs/run_1/horizon-cancel',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});
