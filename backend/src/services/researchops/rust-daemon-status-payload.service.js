'use strict';

const path = require('node:path');
const { buildRustDaemonSupervisorPaths, buildRustDaemonSupervisorState } = require('./rust-daemon-supervisor.service');
const { buildRustDaemonBackgroundLaunchCommand } = require('./rust-daemon-launcher.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function shellQuote(value = '') {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
}

function buildRustDaemonDebugCommands({
  endpoint = '',
  socketPath = '',
} = {}) {
  const normalizedEndpoint = cleanString(endpoint);
  const normalizedSocketPath = cleanString(socketPath);
  const snapshotPayload = `'{\"taskType\":\"bridge.captureWorkspaceSnapshot\",\"payload\":{\"workspacePath\":\"./frontend\",\"kind\":\"workspace_patch\",\"note\":\"local edits\"}}'`;
  if (normalizedSocketPath) {
    return {
      health: `curl --unix-socket ${shellQuote(normalizedSocketPath)} http://localhost/health`,
      runtime: `curl --unix-socket ${shellQuote(normalizedSocketPath)} http://localhost/runtime`,
      taskCatalog: `curl --unix-socket ${shellQuote(normalizedSocketPath)} http://localhost/task-catalog`,
      snapshotCapture: `curl --unix-socket ${shellQuote(normalizedSocketPath)} -X POST http://localhost/tasks/execute -H 'Content-Type: application/json' -d ${snapshotPayload}`,
    };
  }
  if (normalizedEndpoint) {
    const baseUrl = normalizedEndpoint.replace(/\/+$/, '');
    return {
      health: `curl ${baseUrl}/health`,
      runtime: `curl ${baseUrl}/runtime`,
      taskCatalog: `curl ${baseUrl}/task-catalog`,
      snapshotCapture: `curl -X POST ${baseUrl}/tasks/execute -H 'Content-Type: application/json' -d ${snapshotPayload}`,
    };
  }
  return null;
}

function buildRustDaemonEnvFileContent({
  apiBaseUrl = '',
  transport = 'http',
  unixSocket = '/tmp/researchops-local-daemon.sock',
  httpAddr = '127.0.0.1:7788',
} = {}) {
  return [
    `RESEARCHOPS_API_BASE_URL=${String(apiBaseUrl || '').trim()}`,
    'RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS=true',
    `RESEARCHOPS_RUST_DAEMON_TRANSPORT=${transport === 'unix' ? 'unix' : 'http'}`,
    `RESEARCHOPS_RUST_DAEMON_HTTP_ADDR=${String(httpAddr || '127.0.0.1:7788').trim()}`,
    `RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET=${String(unixSocket || '/tmp/researchops-local-daemon.sock').trim()}`,
  ].join('\n');
}

function buildRustDaemonPrototypeRuntimeOptions({
  apiBaseUrl = '',
  cwd = process.cwd(),
  env = process.env,
} = {}) {
  const normalizedApiBaseUrl = cleanString(apiBaseUrl).replace(/\/+$/, '');
  const rustScriptPath = path.join(cwd, 'backend', 'scripts', 'researchops-bootstrap-rust-daemon.sh');
  const backgroundLaunch = normalizedApiBaseUrl
    ? buildRustDaemonBackgroundLaunchCommand({
        cwd,
        env: {
          ...env,
          RESEARCHOPS_API_BASE_URL: normalizedApiBaseUrl,
        },
      })
    : null;
  const supervisorPaths = buildRustDaemonSupervisorPaths({ cwd, env });
  return {
    rustDaemonPrototype: {
      runtime: 'rust',
      status: 'prototype',
      commands: {
        launcher: 'npm --prefix backend run researchops:rust-daemon',
        ...(backgroundLaunch?.command ? { background: backgroundLaunch.command } : {}),
        http: [
          `RESEARCHOPS_API_BASE_URL=${shellQuote(normalizedApiBaseUrl)}`,
          `RESEARCHOPS_RUST_DAEMON_TRANSPORT='http'`,
          `sh ${shellQuote(rustScriptPath)}`,
        ].join(' \\\n'),
        unix: [
          `RESEARCHOPS_API_BASE_URL=${shellQuote(normalizedApiBaseUrl)}`,
          `RESEARCHOPS_RUST_DAEMON_TRANSPORT='unix'`,
          `sh ${shellQuote(rustScriptPath)}`,
        ].join(' \\\n'),
        verify: 'npm --prefix backend run researchops:verify-rust-daemon-prototype',
      },
      supervisorPaths,
      env: {
        RESEARCHOPS_API_BASE_URL: normalizedApiBaseUrl,
        RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS: 'true',
      },
      envFiles: {
        http: {
          filename: '.env.researchops-rust-daemon.http',
          content: buildRustDaemonEnvFileContent({
            apiBaseUrl: normalizedApiBaseUrl,
            transport: 'http',
          }),
        },
        unix: {
          filename: '.env.researchops-rust-daemon.unix',
          content: buildRustDaemonEnvFileContent({
            apiBaseUrl: normalizedApiBaseUrl,
            transport: 'unix',
          }),
        },
      },
    },
  };
}

function buildRustDaemonStatusPayload({
  rustDaemon = null,
  apiBaseUrl = '',
  cwd = process.cwd(),
  env = process.env,
  refreshedAt = '',
} = {}) {
  const runtimeOptions = cleanString(apiBaseUrl)
    ? buildRustDaemonPrototypeRuntimeOptions({ apiBaseUrl, cwd, env })
    : null;
  const source = rustDaemon && typeof rustDaemon === 'object' ? rustDaemon : {};
  const supervisor = buildRustDaemonSupervisorState({ cwd, env });
  const hostReady = source.hostReady === true;
  const containerReady = source.containerReady === true;
  const healthState = cleanString(source.healthState || supervisor.healthState)
    || (cleanString(source.status) === 'disabled' ? 'disabled' : cleanString(source.status) === 'ok' ? 'healthy' : 'degraded');
  const lastFailureReason = cleanString(source.lastFailureReason || supervisor.lastFailureReason || source.error) || null;
  return {
    enabled: source.enabled === true,
    status: cleanString(source.status) || 'disabled',
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    transport: cleanString(source.transport) || null,
    endpoint: cleanString(source.endpoint) || null,
    socketPath: cleanString(source.socketPath) || null,
    hostReady,
    containerReady,
    healthState,
    lastFailureReason,
    runtime: source.runtime && typeof source.runtime === 'object' ? { ...source.runtime } : null,
    taskCatalog: source.taskCatalog && typeof source.taskCatalog === 'object'
      ? {
          ...source.taskCatalog,
          tasks: Array.isArray(source.taskCatalog.tasks)
            ? source.taskCatalog.tasks.map((item) => ({ ...item }))
            : [],
        }
      : null,
    catalogParity: source.catalogParity && typeof source.catalogParity === 'object'
      ? {
          status: cleanString(source.catalogParity.status) || 'unknown',
          expectedVersion: cleanString(source.catalogParity.expectedVersion) || null,
          actualVersion: cleanString(source.catalogParity.actualVersion) || null,
          missingTaskTypes: Array.isArray(source.catalogParity.missingTaskTypes)
            ? source.catalogParity.missingTaskTypes.map((item) => cleanString(item)).filter(Boolean)
            : [],
          extraTaskTypes: Array.isArray(source.catalogParity.extraTaskTypes)
            ? source.catalogParity.extraTaskTypes.map((item) => cleanString(item)).filter(Boolean)
            : [],
        }
      : null,
    error: cleanString(source.error) || null,
    supervisor,
    runtimeOptions,
    debugCommands: buildRustDaemonDebugCommands({
      endpoint: source.endpoint,
      socketPath: source.socketPath,
    }),
    actions: {
      status: {
        method: 'GET',
        path: '/researchops/daemons/rust/status',
      },
      start: {
        method: 'POST',
        path: '/researchops/daemons/rust/start',
      },
      stop: {
        method: 'POST',
        path: '/researchops/daemons/rust/stop',
      },
      enableManaged: {
        method: 'POST',
        path: '/researchops/daemons/rust/enable-managed',
      },
      disableManaged: {
        method: 'POST',
        path: '/researchops/daemons/rust/disable-managed',
      },
      reconcileManaged: {
        method: 'POST',
        path: '/researchops/daemons/rust/reconcile',
      },
      restart: {
        method: 'POST',
        path: '/researchops/daemons/rust/restart',
      },
      health: {
        method: 'GET',
        path: '/researchops/health',
      },
      bootstrap: {
        method: 'POST',
        path: '/researchops/daemons/bootstrap',
      },
    },
  };
}

module.exports = {
  buildRustDaemonDebugCommands,
  buildRustDaemonEnvFileContent,
  buildRustDaemonPrototypeRuntimeOptions,
  buildRustDaemonStatusPayload,
};
