'use strict';

const { requestDaemonRpc: defaultRequestDaemonRpc } = require('./daemon-rpc.service');

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function withOptionalFields(base = {}, extras = {}) {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(asObject(extras))
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, value])
    ),
  };
}

async function callBridgeDaemonTask({
  userId,
  serverId,
  taskType,
  payload = {},
  requestDaemonRpc = defaultRequestDaemonRpc,
} = {}) {
  return requestDaemonRpc({
    userId,
    serverId,
    taskType,
    payload,
  });
}

async function fetchNodeBridgeContextViaDaemon({
  userId,
  serverId,
  projectId,
  nodeId,
  includeContextPack,
  includeReport,
  requestDaemonRpc,
} = {}) {
  return callBridgeDaemonTask({
    userId,
    serverId,
    taskType: 'bridge.fetchNodeContext',
    payload: withOptionalFields({
      projectId: cleanString(projectId),
      nodeId: cleanString(nodeId),
    }, {
      includeContextPack,
      includeReport,
    }),
    requestDaemonRpc,
  });
}

async function fetchRunContextPackViaDaemon({
  userId,
  serverId,
  runId,
  requestDaemonRpc,
} = {}) {
  return callBridgeDaemonTask({
    userId,
    serverId,
    taskType: 'bridge.fetchContextPack',
    payload: {
      runId: cleanString(runId),
    },
    requestDaemonRpc,
  });
}

async function submitNodeBridgeRunViaDaemon({
  userId,
  serverId,
  projectId,
  nodeId,
  force,
  preflightOnly,
  searchTrialCount,
  clarifyMessages,
  workspaceSnapshot,
  localSnapshot,
  requestDaemonRpc,
} = {}) {
  return callBridgeDaemonTask({
    userId,
    serverId,
    taskType: 'bridge.submitNodeRun',
    payload: withOptionalFields({
      projectId: cleanString(projectId),
      nodeId: cleanString(nodeId),
    }, {
      force,
      preflightOnly,
      searchTrialCount,
      clarifyMessages,
      workspaceSnapshot,
      localSnapshot,
    }),
    requestDaemonRpc,
  });
}

async function fetchRunBridgeReportViaDaemon({
  userId,
  serverId,
  runId,
  requestDaemonRpc,
} = {}) {
  return callBridgeDaemonTask({
    userId,
    serverId,
    taskType: 'bridge.fetchRunReport',
    payload: {
      runId: cleanString(runId),
    },
    requestDaemonRpc,
  });
}

async function submitRunBridgeNoteViaDaemon({
  userId,
  serverId,
  runId,
  title,
  content,
  noteType,
  requestDaemonRpc,
} = {}) {
  return callBridgeDaemonTask({
    userId,
    serverId,
    taskType: 'bridge.submitRunNote',
    payload: withOptionalFields({
      runId: cleanString(runId),
    }, {
      title: cleanString(title) || undefined,
      content: cleanString(content) || undefined,
      noteType: cleanString(noteType) || undefined,
    }),
    requestDaemonRpc,
  });
}

module.exports = {
  fetchNodeBridgeContextViaDaemon,
  fetchRunContextPackViaDaemon,
  submitNodeBridgeRunViaDaemon,
  fetchRunBridgeReportViaDaemon,
  submitRunBridgeNoteViaDaemon,
};
