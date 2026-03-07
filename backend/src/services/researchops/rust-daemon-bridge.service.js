'use strict';

const http = require('node:http');
const { readRustDaemonConfig } = require('./rust-daemon-runtime.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function requestRustDaemonJson({
  env = process.env,
  method = 'GET',
  requestPath = '/health',
  body = null,
  timeoutMs = 3000,
} = {}) {
  const config = readRustDaemonConfig(env);
  if (!config.enabled) {
    const error = new Error('Rust daemon transport is not configured');
    error.code = 'RUST_DAEMON_UNAVAILABLE';
    throw error;
  }
  return new Promise((resolve, reject) => {
    const targetUrl = config.transport === 'http' ? new URL(requestPath, config.endpoint) : null;
    const payload = body && typeof body === 'object' ? JSON.stringify(body) : '';
    const request = http.request({
      method,
      ...(config.transport === 'http'
        ? {
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            path: `${targetUrl.pathname}${targetUrl.search}`,
          }
        : {
            socketPath: config.socketPath,
            path: requestPath,
          }),
      headers: {
        Accept: 'application/json',
        Connection: 'close',
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
      },
      timeout: timeoutMs,
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`rust daemon bridge request failed (${response.statusCode || 0})`);
          error.code = 'RUST_DAEMON_REQUEST_FAILED';
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(responseBody || '{}'));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('rust daemon bridge request timeout'));
    });
    request.on('error', reject);
    if (payload) {
      request.write(payload);
    }
    request.end();
  });
}

async function callRustDaemonTask({
  env = process.env,
  taskType,
  payload = {},
} = {}) {
  return requestRustDaemonJson({
    env,
    method: 'POST',
    requestPath: '/tasks/execute',
    body: {
      taskType: cleanString(taskType),
      payload: payload && typeof payload === 'object' ? payload : {},
    },
  });
}

async function fetchNodeBridgeContextViaRustDaemon({
  projectId,
  nodeId,
  includeContextPack,
  includeReport,
  env,
} = {}) {
  return callRustDaemonTask({
    env,
    taskType: 'bridge.fetchNodeContext',
    payload: {
      projectId: cleanString(projectId),
      nodeId: cleanString(nodeId),
      ...(includeContextPack !== undefined ? { includeContextPack } : {}),
      ...(includeReport !== undefined ? { includeReport } : {}),
    },
  });
}

async function fetchRunContextPackViaRustDaemon({
  runId,
  env,
} = {}) {
  return callRustDaemonTask({
    env,
    taskType: 'bridge.fetchContextPack',
    payload: {
      runId: cleanString(runId),
    },
  });
}

async function submitNodeBridgeRunViaRustDaemon({
  projectId,
  nodeId,
  force,
  preflightOnly,
  searchTrialCount,
  clarifyMessages,
  workspaceSnapshot,
  localSnapshot,
  env,
} = {}) {
  return callRustDaemonTask({
    env,
    taskType: 'bridge.submitNodeRun',
    payload: {
      projectId: cleanString(projectId),
      nodeId: cleanString(nodeId),
      ...(force !== undefined ? { force } : {}),
      ...(preflightOnly !== undefined ? { preflightOnly } : {}),
      ...(searchTrialCount !== undefined ? { searchTrialCount } : {}),
      ...(clarifyMessages !== undefined ? { clarifyMessages } : {}),
      ...(workspaceSnapshot !== undefined ? { workspaceSnapshot } : {}),
      ...(localSnapshot !== undefined ? { localSnapshot } : {}),
    },
  });
}

async function fetchRunBridgeReportViaRustDaemon({
  runId,
  env,
} = {}) {
  return callRustDaemonTask({
    env,
    taskType: 'bridge.fetchRunReport',
    payload: {
      runId: cleanString(runId),
    },
  });
}

async function submitRunBridgeNoteViaRustDaemon({
  runId,
  title,
  content,
  noteType,
  env,
} = {}) {
  return callRustDaemonTask({
    env,
    taskType: 'bridge.submitRunNote',
    payload: {
      runId: cleanString(runId),
      ...(cleanString(title) ? { title: cleanString(title) } : {}),
      ...(cleanString(content) ? { content: cleanString(content) } : {}),
      ...(cleanString(noteType) ? { noteType: cleanString(noteType) } : {}),
    },
  });
}

module.exports = {
  callRustDaemonTask,
  fetchNodeBridgeContextViaRustDaemon,
  fetchRunBridgeReportViaRustDaemon,
  fetchRunContextPackViaRustDaemon,
  requestRustDaemonJson,
  submitNodeBridgeRunViaRustDaemon,
  submitRunBridgeNoteViaRustDaemon,
};
