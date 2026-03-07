'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunEventListPayload } = require('../run-event-list-payload.service');

test('buildRunEventListPayload normalizes event list payloads for run replay flows', () => {
  const payload = buildRunEventListPayload({
    runId: 'run_1',
    afterSequence: '12',
    result: {
      items: [
        {
          id: 'evt_1',
          runId: 'run_1',
          sequence: '13',
          eventType: 'STEP',
          status: 'running',
          message: 'step started',
          progress: '50',
          payload: { stepId: 'step_1' },
          timestamp: '2026-03-06T12:00:00.000Z',
        },
      ],
      nextAfterSequence: 13,
    },
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.filters.afterSequence, '12');
  assert.equal(payload.items[0].sequence, 13);
  assert.equal(payload.items[0].status, 'RUNNING');
  assert.equal(payload.nextAfterSequence, 13);
});
