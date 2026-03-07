'use strict';

const http = require('node:http');
const {
  DAEMON_TASK_CATALOG_VERSION,
  listDaemonTaskDescriptors,
} = require('./daemon-task-descriptor.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = cleanString(value).toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeHealthState(value, fallback = 'unknown') {
  const normalized = cleanString(value).toLowerCase();
  if (['healthy', 'degraded', 'reconciling', 'disabled'].includes(normalized)) {
    return normalized;
  }
  return fallback;
}

function projectRuntimeReadiness({ status = '', runtime = null, error = '' } = {}) {
  if (status === 'disabled') {
    return {
      hostReady: false,
      containerReady: false,
      healthState: 'disabled',
      lastFailureReason: null,
    };
  }
  if (status !== 'ok') {
    return {
      hostReady: false,
      containerReady: false,
      healthState: 'degraded',
      lastFailureReason: cleanString(error) || null,
    };
  }

  const source = runtime && typeof runtime === 'object' ? runtime : {};
  const hostReady = readBoolean(source.hostReady ?? source.host_ready, true);
  const containerReady = readBoolean(source.containerReady ?? source.container_ready, false);
  const lastFailureReason = cleanString(source.lastFailureReason ?? source.last_failure_reason) || null;
  const healthState = normalizeHealthState(
    source.healthState ?? source.health_state,
    hostReady && containerReady ? 'healthy' : hostReady ? 'degraded' : 'reconciling'
  );
  return {
    hostReady,
    containerReady,
    healthState,
    lastFailureReason,
  };
}

function readRustDaemonConfig(env = process.env) {
  const endpoint = cleanString(env?.RESEARCHOPS_RUST_DAEMON_URL);
  if (endpoint) {
    return {
      enabled: true,
      transport: 'http',
      endpoint,
      socketPath: null,
    };
  }
  const socketPath = cleanString(env?.RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET);
  if (socketPath) {
    return {
      enabled: true,
      transport: 'unix',
      endpoint: null,
      socketPath,
    };
  }
  return {
    enabled: false,
    transport: null,
    endpoint: null,
    socketPath: null,
  };
}

function requestJson({ transport, endpoint, socketPath, requestPath = '/runtime', timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const targetUrl = transport === 'http' ? new URL(requestPath, endpoint) : null;
    const request = http.request({
      method: 'GET',
      ...(transport === 'http'
        ? {
            hostname: targetUrl.hostname,
            port: targetUrl.port || 80,
            path: `${targetUrl.pathname}${targetUrl.search}`,
          }
        : {
            socketPath,
            path: requestPath,
          }),
      headers: {
        Accept: 'application/json',
        Connection: 'close',
      },
      timeout: timeoutMs,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`rust daemon probe failed (${response.statusCode || 0})`));
          return;
        }
        try {
          resolve(JSON.parse(body || '{}'));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('rust daemon probe timeout'));
    });
    request.on('error', reject);
    request.end();
  });
}

function buildExpectedTaskCatalog() {
  return {
    version: DAEMON_TASK_CATALOG_VERSION,
    taskTypes: listDaemonTaskDescriptors()
      .map((item) => cleanString(item?.taskType || item?.task_type))
      .filter(Boolean)
      .sort(),
  };
}

function normalizeTaskCatalog(taskCatalog = null) {
  const source = taskCatalog && typeof taskCatalog === 'object' ? taskCatalog : {};
  return {
    version: cleanString(source.version),
    tasks: (Array.isArray(source.tasks) ? source.tasks : [])
      .map((item) => {
        const taskType = cleanString(item?.task_type || item?.taskType);
        return taskType ? { ...(item && typeof item === 'object' ? item : {}), task_type: taskType } : null;
      })
      .filter(Boolean),
  };
}

function compareRustTaskCatalog(taskCatalog = null) {
  const normalized = normalizeTaskCatalog(taskCatalog);
  if (!normalized.version || normalized.tasks.length === 0) {
    return {
      status: 'unknown',
      expectedVersion: DAEMON_TASK_CATALOG_VERSION,
      actualVersion: normalized.version || null,
      missingTaskTypes: [],
      extraTaskTypes: [],
    };
  }
  const expected = buildExpectedTaskCatalog();
  const actualTaskTypes = normalized.tasks
    .map((item) => cleanString(item?.task_type))
    .filter(Boolean)
    .sort();
  const actualSet = new Set(actualTaskTypes);
  const expectedSet = new Set(expected.taskTypes);
  const missingTaskTypes = expected.taskTypes.filter((item) => !actualSet.has(item));
  const extraTaskTypes = actualTaskTypes.filter((item) => !expectedSet.has(item));
  const versionMatches = normalized.version === expected.version;
  return {
    status: versionMatches && missingTaskTypes.length === 0 && extraTaskTypes.length === 0 ? 'aligned' : 'mismatch',
    expectedVersion: expected.version,
    actualVersion: normalized.version,
    missingTaskTypes,
    extraTaskTypes,
  };
}

async function probeRustDaemonRuntime({
  env = process.env,
  timeoutMs = 1500,
} = {}) {
  const config = readRustDaemonConfig(env);
  if (!config.enabled) {
    return {
      enabled: false,
      status: 'disabled',
      transport: null,
      endpoint: null,
      socketPath: null,
      runtime: null,
      hostReady: false,
      containerReady: false,
      healthState: 'disabled',
      lastFailureReason: null,
      error: null,
    };
  }

  try {
    const [runtime, taskCatalog] = await Promise.all([
      requestJson({
        transport: config.transport,
        endpoint: config.endpoint,
        socketPath: config.socketPath,
        requestPath: '/runtime',
        timeoutMs,
      }),
      requestJson({
        transport: config.transport,
        endpoint: config.endpoint,
        socketPath: config.socketPath,
        requestPath: '/task-catalog',
        timeoutMs,
      }).catch(() => null),
    ]);
    const normalizedTaskCatalog = normalizeTaskCatalog(taskCatalog);
    const readiness = projectRuntimeReadiness({
      status: 'ok',
      runtime,
    });
    return {
      enabled: true,
      status: 'ok',
      transport: config.transport,
      endpoint: config.endpoint,
      socketPath: config.socketPath,
      runtime,
      ...readiness,
      taskCatalog: normalizedTaskCatalog.version || normalizedTaskCatalog.tasks.length > 0
        ? normalizedTaskCatalog
        : null,
      catalogParity: compareRustTaskCatalog(taskCatalog),
      error: null,
    };
  } catch (error) {
    const readiness = projectRuntimeReadiness({
      status: 'error',
      error: cleanString(error?.message),
    });
    return {
      enabled: true,
      status: 'error',
      transport: config.transport,
      endpoint: config.endpoint,
      socketPath: config.socketPath,
      runtime: null,
      ...readiness,
      taskCatalog: null,
      catalogParity: {
        status: 'unknown',
        expectedVersion: DAEMON_TASK_CATALOG_VERSION,
        actualVersion: null,
        missingTaskTypes: [],
        extraTaskTypes: [],
      },
      error: cleanString(error?.message) || 'Failed to probe rust daemon runtime',
    };
  }
}

module.exports = {
  compareRustTaskCatalog,
  normalizeTaskCatalog,
  probeRustDaemonRuntime,
  projectRuntimeReadiness,
  readRustDaemonConfig,
};
