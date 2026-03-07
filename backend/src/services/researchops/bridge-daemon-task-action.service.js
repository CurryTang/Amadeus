'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildTaskAction(serverId = '', taskType = '', payload = {}) {
  const safeServerId = cleanString(serverId);
  const safeTaskType = cleanString(taskType);
  if (!safeServerId || !safeTaskType) return null;
  return {
    transport: 'daemon-task',
    serverId: safeServerId,
    taskType: safeTaskType,
    payload,
  };
}

function buildBridgeDaemonTaskActions({
  serverId = '',
  projectId = '',
  nodeId = '',
  runId = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  const safeRunId = cleanString(runId);
  return {
    ...(safeProjectId && safeNodeId ? {
      fetchNodeContext: buildTaskAction(serverId, 'bridge.fetchNodeContext', {
        projectId: safeProjectId,
        nodeId: safeNodeId,
      }),
      submitNodeRun: buildTaskAction(serverId, 'bridge.submitNodeRun', {
        projectId: safeProjectId,
        nodeId: safeNodeId,
      }),
    } : {}),
    ...(safeRunId ? {
      fetchContextPack: buildTaskAction(serverId, 'bridge.fetchContextPack', {
        runId: safeRunId,
      }),
      fetchRunReport: buildTaskAction(serverId, 'bridge.fetchRunReport', {
        runId: safeRunId,
      }),
      submitRunNote: buildTaskAction(serverId, 'bridge.submitRunNote', {
        runId: safeRunId,
      }),
    } : {}),
  };
}

module.exports = {
  buildBridgeDaemonTaskActions,
};
