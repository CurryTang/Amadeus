'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunStepListPayload } = require('../run-step-list-payload.service');

test('buildRunStepListPayload normalizes step items for current run detail flows', () => {
  const payload = buildRunStepListPayload({
    runId: 'run_1',
    items: [
      {
        id: 'step_1',
        runId: 'run_1',
        status: 'running',
        message: 'Executing setup',
        progress: '25',
        payload: { phase: 'setup' },
        timestamp: '2026-03-06T12:00:00.000Z',
      },
    ],
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'RUNNING');
  assert.equal(payload.items[0].progress, 25);
  assert.deepEqual(payload.items[0].payload, { phase: 'setup' });
});
