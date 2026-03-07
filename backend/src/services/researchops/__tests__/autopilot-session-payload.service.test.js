'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutopilotSessionPayload,
  buildAutopilotSessionListPayload,
} = require('../autopilot-session-payload.service');

test('buildAutopilotSessionPayload exposes session actions and current run follow-up', () => {
  const payload = buildAutopilotSessionPayload({
    session: {
      id: 'ap_1',
      projectId: 'proj_1',
      status: 'running',
      currentPhase: 'implementing',
      currentRunId: 'run_123',
      currentIteration: 2,
      maxIterations: 10,
      goalAchieved: false,
    },
  });

  assert.equal(payload.session.id, 'ap_1');
  assert.equal(payload.session.status, 'RUNNING');
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/autopilot/ap_1',
  });
  assert.deepEqual(payload.actions.stop, {
    method: 'POST',
    path: '/researchops/autopilot/ap_1/stop',
  });
  assert.deepEqual(payload.actions.currentRun, {
    method: 'GET',
    path: '/researchops/runs/run_123',
  });
});

test('buildAutopilotSessionListPayload keeps sessions under project scope', () => {
  const payload = buildAutopilotSessionListPayload({
    projectId: 'proj_1',
    sessions: [
      { id: 'ap_2', projectId: 'proj_1', status: 'completed' },
    ],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].status, 'COMPLETED');
});
