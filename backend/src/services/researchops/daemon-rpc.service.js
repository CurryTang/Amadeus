'use strict';

const store = require('./store');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDaemonRpc({
  userId,
  serverId,
  taskType,
  payload = {},
  timeoutMs = 15000,
  pollIntervalMs = 200,
  store: customStore = store,
} = {}) {
  if (!userId) throw new Error('userId is required');
  if (!serverId) throw new Error('serverId is required');
  if (!taskType) throw new Error('taskType is required');

  const task = await customStore.enqueueDaemonTask(userId, {
    serverId,
    taskType,
    payload,
  });
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const current = await customStore.getDaemonTask(userId, task.id);
    if (!current) {
      throw new Error(`Daemon task ${task.id} disappeared before completion`);
    }
    if (current.status === 'SUCCEEDED') {
      return current.result || {};
    }
    if (current.status === 'FAILED') {
      throw new Error(String(current.error || 'Daemon task failed'));
    }
    await sleep(Math.max(Number(pollIntervalMs) || 200, 1));
  }

  throw new Error(`Daemon task ${task.id} timed out after ${timeoutMs}ms`);
}

module.exports = {
  requestDaemonRpc,
};
