'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTodoClarifyPayload,
  buildTreeRunClarifyPayload,
} = require('../tree-clarify-payload.service');

test('buildTodoClarifyPayload preserves done/question/options and exposes follow-up actions', () => {
  const payload = buildTodoClarifyPayload({
    projectId: 'proj_1',
    result: {
      done: false,
      question: 'Which module should this touch?',
      options: ['parser', 'runner'],
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.done, false);
  assert.equal(payload.question, 'Which module should this touch?');
  assert.deepEqual(payload.options, ['parser', 'runner']);
  assert.deepEqual(payload.actions.clarify, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/from-todo/clarify',
  });
});

test('buildTreeRunClarifyPayload preserves node-scoped clarify roots and actions', () => {
  const payload = buildTreeRunClarifyPayload({
    projectId: 'proj_1',
    nodeId: 'node_1',
    result: {
      done: true,
      question: null,
      options: [],
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_1');
  assert.equal(payload.done, true);
  assert.equal(payload.question, null);
  assert.deepEqual(payload.options, []);
  assert.deepEqual(payload.actions.clarify, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_1/run-clarify',
  });
});
