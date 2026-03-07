'use strict';

const { buildBridgeDaemonTaskRequest } = require('./bridge-daemon-task-request.service');
const { contextualizeDaemonTaskDescriptor } = require('./daemon-task-descriptor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTask(task = null) {
  const source = asObject(task);
  const taskType = cleanString(source.taskType) || null;
  const request = buildBridgeDaemonTaskRequest(taskType, source.payload);
  return {
    ...source,
    id: cleanString(source.id) || null,
    serverId: cleanString(source.serverId) || null,
    taskType,
    status: cleanString(source.status).toUpperCase() || 'QUEUED',
    payload: asObject(source.payload),
    result: source.result && typeof source.result === 'object' ? source.result : null,
    error: cleanString(source.error) || null,
    createdAt: cleanString(source.createdAt) || null,
    updatedAt: cleanString(source.updatedAt) || null,
    leasedAt: cleanString(source.leasedAt) || null,
    completedAt: cleanString(source.completedAt) || null,
    descriptor: contextualizeDaemonTaskDescriptor(taskType, {
      supportedTaskTypes: [taskType],
      request,
    }),
    request,
  };
}

function buildTaskActions(taskId = '') {
  const safeTaskId = cleanString(taskId);
  if (!safeTaskId) return {};
  return {
    complete: {
      method: 'POST',
      path: `/researchops/daemons/tasks/${encodeURIComponent(safeTaskId)}/complete`,
    },
  };
}

function buildTaskSubmitHints() {
  return {
    complete: {
      body: {
        ok: 'boolean',
        result: 'object',
        error: 'string',
      },
    },
  };
}

function buildDaemonTaskPayload({ task = null } = {}) {
  const normalizedTask = normalizeTask(task);
  return {
    task: normalizedTask,
    actions: buildTaskActions(normalizedTask.id),
    submitHints: buildTaskSubmitHints(),
  };
}

function buildDaemonTaskClaimPayload({ task = null } = {}) {
  return buildDaemonTaskPayload({ task });
}

function buildDaemonTaskCompletionPayload({ task = null } = {}) {
  return buildDaemonTaskPayload({ task });
}

module.exports = {
  buildDaemonTaskPayload,
  buildDaemonTaskClaimPayload,
  buildDaemonTaskCompletionPayload,
};
