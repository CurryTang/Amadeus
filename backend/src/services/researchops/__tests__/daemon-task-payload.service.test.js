'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildDaemonTaskPayload,
  buildDaemonTaskClaimPayload,
  buildDaemonTaskCompletionPayload,
} = require('../daemon-task-payload.service');

test('buildDaemonTaskPayload exposes daemon task controls and completion hints', () => {
  const payload = buildDaemonTaskPayload({
    task: {
      id: 'task_1',
      serverId: 'srv_client_1',
      taskType: 'project.checkPath',
      status: 'RUNNING',
      payload: {
        projectPath: '/Users/alice/project',
      },
    },
  });

  assert.equal(payload.task.id, 'task_1');
  assert.equal(payload.task.taskType, 'project.checkPath');
  assert.equal(payload.task.descriptor.taskType, 'project.checkPath');
  assert.equal(payload.task.descriptor.handlerMode, 'builtin');
  assert.deepEqual(payload.actions.complete, {
    method: 'POST',
    path: '/researchops/daemons/tasks/task_1/complete',
  });
  assert.deepEqual(payload.submitHints.complete.body, {
    ok: 'boolean',
    result: 'object',
    error: 'string',
  });
});

test('buildDaemonTaskClaimPayload wraps a claimed task in the normalized task payload', () => {
  const payload = buildDaemonTaskClaimPayload({
    task: {
      id: 'task_2',
      serverId: 'srv_client_2',
      taskType: 'project.ensureGit',
      status: 'RUNNING',
      payload: {},
    },
  });

  assert.equal(payload.task.id, 'task_2');
  assert.equal(payload.actions.complete.path, '/researchops/daemons/tasks/task_2/complete');
});

test('buildDaemonTaskCompletionPayload keeps the completed task shape and completion controls', () => {
  const payload = buildDaemonTaskCompletionPayload({
    task: {
      id: 'task_3',
      serverId: 'srv_client_3',
      taskType: 'project.ensurePath',
      status: 'SUCCEEDED',
      result: {
        normalizedPath: '/Users/alice/project',
      },
    },
  });

  assert.equal(payload.task.status, 'SUCCEEDED');
  assert.equal(payload.task.result.normalizedPath, '/Users/alice/project');
  assert.equal(payload.actions.complete.path, '/researchops/daemons/tasks/task_3/complete');
});

test('buildDaemonTaskPayload carries optional bridge task descriptors for custom handlers', () => {
  const payload = buildDaemonTaskPayload({
    task: {
      id: 'task_bridge_1',
      serverId: 'srv_client_9',
      taskType: 'bridge.fetchRunReport',
      status: 'QUEUED',
      payload: {
        runId: 'run_123',
      },
    },
  });

  assert.equal(payload.task.descriptor.taskType, 'bridge.fetchRunReport');
  assert.equal(payload.task.descriptor.builtIn, false);
  assert.equal(payload.task.descriptor.handlerMode, 'builtin-http-proxy');
  assert.deepEqual(payload.task.request, {
    method: 'GET',
    path: '/researchops/runs/run_123/bridge-report',
  });
});
