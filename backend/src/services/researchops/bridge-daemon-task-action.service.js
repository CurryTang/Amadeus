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
  sourceServerId = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  const safeRunId = cleanString(runId);
  const safeSourceServerId = cleanString(sourceServerId);
  const captureWorkspaceSnapshot = buildTaskAction(serverId, 'bridge.captureWorkspaceSnapshot', {
    workspacePath: null,
    sourceServerId: safeSourceServerId || null,
    kind: 'workspace_patch',
    note: null,
  });
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
    ...(captureWorkspaceSnapshot ? { captureWorkspaceSnapshot } : {}),
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

function buildBridgeDaemonTaskSubmitHints() {
  return {
    captureWorkspaceSnapshot: {
      payload: {
        workspacePath: 'string',
        sourceServerId: 'string|null',
        kind: 'string',
        note: 'string|null',
      },
    },
  };
}

module.exports = {
  buildBridgeDaemonTaskActions,
  buildBridgeDaemonTaskSubmitHints,
};
