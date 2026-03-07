'use strict';

const os = require('os');
const projectInsightsService = require('../project-insights.service');

function normalizeApiBaseUrl(input = '') {
  return String(input || '').trim().replace(/\/+$/, '');
}

function authHeaders(adminToken = '') {
  const headers = { 'Content-Type': 'application/json' };
  if (adminToken) headers.authorization = `Bearer ${adminToken}`;
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildDaemonApiPaths(registerResponse = {}) {
  const actions = asObject(asObject(registerResponse.daemon).actions);
  const heartbeatPath = cleanString(actions.heartbeat?.path) || '/researchops/daemons/heartbeat';
  const claimTaskPath = cleanString(actions.claimTask?.path) || '/researchops/daemons/tasks/claim';
  const completeTaskTemplate = cleanString(actions.completeTask?.pathTemplate)
    || '/researchops/daemons/tasks/{taskId}/complete';
  return {
    heartbeatPath,
    claimTaskPath,
    completeTaskTemplate,
  };
}

async function defaultApiRequest(apiBaseUrl, adminToken, path, { method = 'GET', body, allowNoContent = false } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: authHeaders(adminToken),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (allowNoContent && response.status === 204) return null;
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${path} failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return null;
}

function createTaskExecutor(customHandlers = {}) {
  return async function executeTask(task) {
    const taskType = String(task?.taskType || '').trim();
    const projectPath = String(task?.payload?.projectPath || '').trim();
    if (typeof customHandlers[taskType] === 'function') {
      return customHandlers[taskType](task);
    }
    if (taskType === 'project.checkPath') {
      return projectInsightsService.checkLocalProjectPath(projectPath);
    }
    if (taskType === 'project.ensurePath') {
      return projectInsightsService.ensureLocalProjectPath(projectPath);
    }
    if (taskType === 'project.ensureGit') {
      return projectInsightsService.ensureLocalGitRepository(projectPath);
    }
    throw new Error(`Unsupported daemon task type: ${taskType}`);
  };
}

function startClientDaemon({
  apiBaseUrl = '',
  adminToken = '',
  bootstrapId = '',
  bootstrapSecret = '',
  hostname = os.hostname(),
  heartbeatMs = 30000,
  pollMs = 1500,
  handlers = {},
  onRegistered = null,
  logger = console,
} = {}) {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (!normalizedApiBaseUrl) {
    return { enabled: false, stop: async () => {} };
  }

  const executeTask = createTaskExecutor(handlers);
  let stopped = false;
  let heartbeatTimer = null;

  const apiRequest = (path, options) => defaultApiRequest(normalizedApiBaseUrl, adminToken, path, options);
  const normalizedBootstrapId = String(bootstrapId || '').trim();
  const normalizedBootstrapSecret = String(bootstrapSecret || '').trim();

  const loopPromise = (async () => {
    const registerResponse = await apiRequest('/researchops/daemons/register', {
      method: 'POST',
      body: {
        hostname,
        status: 'ONLINE',
        labels: { role: 'client-device' },
        bootstrapId: normalizedBootstrapId || undefined,
        bootstrapSecret: normalizedBootstrapSecret || undefined,
      },
    });
    const serverId = String(registerResponse?.serverId || '').trim();
    if (!serverId) throw new Error('Failed to obtain daemon serverId from backend');
    const daemonApiPaths = buildDaemonApiPaths(registerResponse);

    if (typeof onRegistered === 'function') {
      await Promise.resolve(onRegistered({
        serverId,
        hostname,
        apiBaseUrl: normalizedApiBaseUrl,
        usedBootstrap: !!(normalizedBootstrapId && normalizedBootstrapSecret),
      }));
    }

    logger.log(`[ResearchOpsDaemon] registered ${hostname} as ${serverId}`);

    const sendHeartbeat = async () => {
      await apiRequest(daemonApiPaths.heartbeatPath, {
        method: 'POST',
        body: {
          serverId,
          status: 'ONLINE',
        },
      });
    };

    await sendHeartbeat();
    heartbeatTimer = setInterval(() => {
      sendHeartbeat().catch((error) => {
        logger.error('[ResearchOpsDaemon] heartbeat failed:', error.message);
      });
    }, Math.max(Number(heartbeatMs) || 30000, 5000));

    while (!stopped) {
      const response = await apiRequest(daemonApiPaths.claimTaskPath, {
        method: 'POST',
        body: { serverId },
        allowNoContent: true,
      });
      const task = response?.task || null;
      if (!task) {
        await sleep(Math.max(Number(pollMs) || 1500, 250));
        continue;
      }

      try {
        const result = await executeTask(task);
        await apiRequest(
          daemonApiPaths.completeTaskTemplate.replace('{taskId}', encodeURIComponent(task.id)),
          {
          method: 'POST',
          body: { ok: true, result },
          }
        );
      } catch (error) {
        await apiRequest(
          daemonApiPaths.completeTaskTemplate.replace('{taskId}', encodeURIComponent(task.id)),
          {
          method: 'POST',
          body: { ok: false, error: error?.message || 'Daemon task failed' },
          }
        ).catch((reportError) => {
          logger.error('[ResearchOpsDaemon] failed to report task error:', reportError.message);
        });
      }
    }
  })();

  return {
    enabled: true,
    promise: loopPromise,
    stop: async () => {
      stopped = true;
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      await Promise.resolve();
    },
  };
}

module.exports = {
  startClientDaemon,
};
