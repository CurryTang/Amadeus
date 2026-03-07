'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExperimentExecutePayload } = require('../experiment-execute-payload.service');

test('buildExperimentExecutePayload preserves proxied result roots while exposing actions', () => {
  const payload = buildExperimentExecutePayload({
    projectId: 'proj_1',
    serverId: 'srv_1',
    mode: 'remote-proxy',
    result: {
      stdout: 'ok',
      exitCode: 0,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.serverId, 'srv_1');
  assert.equal(payload.mode, 'remote-proxy');
  assert.equal(payload.stdout, 'ok');
  assert.deepEqual(payload.actions.execute, {
    method: 'POST',
    path: '/researchops/experiments/execute',
  });
});

test('buildExperimentExecutePayload preserves local run root and exposes run follow-up views', () => {
  const payload = buildExperimentExecutePayload({
    projectId: 'proj_1',
    serverId: 'local-default',
    mode: 'local-backend-runner',
    run: {
      id: 'run_1',
      projectId: 'proj_1',
      status: 'RUNNING',
    },
  });

  assert.equal(payload.mode, 'local-backend-runner');
  assert.equal(payload.run.id, 'run_1');
  assert.equal(payload.attempt.runId, 'run_1');
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
});
