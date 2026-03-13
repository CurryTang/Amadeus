'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const documentPlanEventsService = require('../document-plan-events.service');

test('parseDocumentPlanEventLine parses structured progress events', () => {
  const parsed = documentPlanEventsService.parseDocumentPlanEventLine(
    'DOCUMENT_STEP_EVENT {"stepId":"step_1","nodeId":"docplan_alpha__step_1","status":"running","progress":35,"message":"Reading repo"}'
  );

  assert.deepEqual(parsed, {
    eventType: 'STEP_PROGRESS',
    status: 'RUNNING',
    message: 'Reading repo',
    progress: 35,
    payload: {
      stepId: 'step_1',
      nodeId: 'docplan_alpha__step_1',
      status: 'running',
    },
  });
});

test('parseDocumentPlanEventLine ignores ordinary log lines', () => {
  assert.equal(documentPlanEventsService.parseDocumentPlanEventLine('plain log output'), null);
});
