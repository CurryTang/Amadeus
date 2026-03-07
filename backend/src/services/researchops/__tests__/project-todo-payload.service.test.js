'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectTodoNextActionsPayload,
  buildProjectTodoClearPayload,
} = require('../project-todo-payload.service');

test('buildProjectTodoNextActionsPayload preserves next-action roots and adds follow-up actions', () => {
  const payload = buildProjectTodoNextActionsPayload({
    projectId: 'proj_1',
    result: {
      generatedAt: '2026-03-06T12:00:00.000Z',
      context: {
        openTodoCount: 3,
        totalRunCount: 4,
      },
      actionable: [{ todoId: 'idea_1', title: 'Do next thing' }],
      blocked: [{ todoId: 'idea_2', title: 'Blocked thing' }],
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.context.openTodoCount, 3);
  assert.equal(payload.actionable.length, 1);
  assert.equal(payload.blocked.length, 1);
  assert.deepEqual(payload.actions.nextActions, {
    method: 'GET',
    path: '/researchops/projects/proj_1/todos/next-actions',
  });
  assert.deepEqual(payload.actions.clearTodos, {
    method: 'POST',
    path: '/researchops/projects/proj_1/todos/clear',
  });
});

test('buildProjectTodoClearPayload preserves clear roots and adds follow-up actions', () => {
  const payload = buildProjectTodoClearPayload({
    projectId: 'proj_1',
    cleared: 5,
    totalTodos: 7,
    status: 'COMPLETED',
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.cleared, 5);
  assert.equal(payload.totalTodos, 7);
  assert.equal(payload.status, 'COMPLETED');
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.nextActions, {
    method: 'GET',
    path: '/researchops/projects/proj_1/todos/next-actions',
  });
});
