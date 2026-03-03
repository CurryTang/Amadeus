'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const { getDb } = require('../../db');
const researchOpsStore = require('../../services/researchops/store');
const researchOpsRunner = require('../../services/researchops/runner');
const { parseLimit, getUserId, sanitizeError } = require('./shared');

const CHATDSE_ENFORCED_HOST = 'compute.example.edu';
const CHATDSE_PROJECT_ROOT = '/egr/research-dselab/testuser';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCount(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractGpuCapacity(capacityInput = {}) {
  const capacity = asObject(capacityInput);
  const gpu = asObject(capacity.gpu);
  const gpus = Array.isArray(capacity.gpus) ? capacity.gpus : [];
  const total = normalizeCount(
    gpu.count ?? gpu.total ?? capacity.gpuCount ?? capacity.gpu_total,
    gpus.length
  );
  const availableExplicit = gpu.available ?? gpu.free ?? capacity.gpuAvailable ?? capacity.gpu_available;
  const available = availableExplicit !== undefined
    ? normalizeCount(availableExplicit, Math.max(total, 0))
    : Math.max(total - gpus.filter((entry) => String(entry?.running_node || entry?.runningNode || '').trim()).length, 0);
  return { total, available };
}

function extractCpuMemoryCapacity(capacityInput = {}) {
  const capacity = asObject(capacityInput);
  const cpu = asObject(capacity.cpu);
  const total = toNumber(
    cpu.memory_gb
    ?? cpu.memoryGb
    ?? cpu.memory_total_gb
    ?? capacity.memory_gb
    ?? capacity.memoryGb,
    0
  );
  const available = toNumber(
    cpu.memory_available_gb
    ?? cpu.memoryAvailableGb
    ?? capacity.memory_available_gb
    ?? capacity.memoryAvailableGb,
    Math.max(total, 0)
  );
  return { total, available };
}

function deriveDaemonStatus(daemon, { staleAfterMs = 90 * 1000 } = {}) {
  const rawStatus = String(daemon?.status || '').trim().toUpperCase();
  const heartbeatAt = String(daemon?.heartbeatAt || '').trim();
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  const stale = !Number.isFinite(heartbeatMs) || (Date.now() - heartbeatMs > staleAfterMs);
  if (rawStatus === 'DRAINING') return 'DRAINING';
  if (rawStatus === 'OFFLINE') return 'OFFLINE';
  return stale ? 'OFFLINE' : 'ONLINE';
}

function parseProviderConcurrencyLimits() {
  const defaultsRaw = Number(process.env.RESEARCHOPS_MAX_CONCURRENT_AGENTS || 3);
  const defaultLimit = Number.isFinite(defaultsRaw) && defaultsRaw > 0 ? Math.floor(defaultsRaw) : 3;
  const parsed = {};
  const source = String(process.env.RESEARCHOPS_AGENT_LIMITS || '').trim();
  if (source) {
    try {
      const json = JSON.parse(source);
      if (json && typeof json === 'object') {
        Object.entries(json).forEach(([provider, value]) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) parsed[String(provider)] = Math.floor(n);
        });
      }
    } catch (_) {
      // Ignore malformed env and keep defaults.
    }
  }
  return { defaultLimit, parsed };
}

async function getSshServerById(serverId) {
  const sid = String(serverId || '').trim();
  if (!sid) return null;
  const db = getDb();
  let result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE id = ?`,
    args: [sid],
  });
  if (result.rows?.[0]) return result.rows[0];
  result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE name = ?`,
    args: [sid],
  });
  return result.rows?.[0] || null;
}

function normalizePosixPathForPolicy(inputPath = '') {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function isPathWithinBase(targetPath = '', basePath = '') {
  const target = normalizePosixPathForPolicy(targetPath);
  const base = normalizePosixPathForPolicy(basePath);
  if (!target || !base) return false;
  return target === base || target.startsWith(`${base}/`);
}

function enforceSshProjectPathPolicy(server = null, projectPath = '') {
  const host = String(server?.host || '').trim().toLowerCase();
  if (host !== CHATDSE_ENFORCED_HOST) return;
  if (!isPathWithinBase(projectPath, CHATDSE_PROJECT_ROOT)) {
    throw new Error(`For ${CHATDSE_ENFORCED_HOST}, projectPath must be under ${CHATDSE_PROJECT_ROOT}`);
  }
}

async function resolveProjectContext(userId, projectId) {
  const project = await researchOpsStore.getProject(userId, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }
  if (!project.projectPath && !project.kbFolderPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  if (project.locationType === 'ssh') {
    const server = await getSshServerById(project.serverId);
    if (!server) {
      const error = new Error(`SSH server ${project.serverId} not found`);
      error.code = 'SSH_SERVER_NOT_FOUND';
      throw error;
    }
    return { project, server };
  }

  return { project, server: null };
}

async function enforceExperimentProjectPathPolicy(userId, projectId, runType = '') {
  if (String(runType || '').trim().toUpperCase() !== 'EXPERIMENT') return;
  const { project, server } = await resolveProjectContext(userId, projectId);
  if (String(project.locationType || '').toLowerCase() !== 'ssh') return;
  enforceSshProjectPathPolicy(server, project.projectPath);
}

function withTimeout(promiseFactory, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promiseFactory(controller.signal).finally(() => clearTimeout(timer));
}

router.get('/scheduler/queue', async (req, res) => {
  try {
    const items = await researchOpsStore.listQueue(getUserId(req), {
      serverId: String(req.query.serverId || '').trim(),
      limit: parseLimit(req.query.limit, 100, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listQueue failed:', error);
    res.status(500).json({ error: 'Failed to list queue' });
  }
});

router.post('/scheduler/lease-next', async (req, res) => {
  try {
    const leased = await researchOpsStore.leaseNextRun(getUserId(req), {
      serverId: String(req.body?.serverId || '').trim(),
    });
    return res.json(leased);
  } catch (error) {
    console.error('[ResearchOps] leaseNext failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease run') });
  }
});

router.post('/scheduler/lease-and-execute', async (req, res) => {
  try {
    const result = await researchOpsRunner.leaseAndExecuteNext(
      getUserId(req),
      String(req.body?.serverId || '').trim() || 'local-default'
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] leaseAndExecute failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease and execute') });
  }
});

router.post('/scheduler/recover-stale', async (req, res) => {
  try {
    const result = await researchOpsRunner.recoverStaleRuns(getUserId(req), {
      minutesStale: req.body?.minutesStale,
      serverId: String(req.body?.serverId || '').trim(),
      dryRun: req.body?.dryRun === true,
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] recoverStale failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to recover stale runs') });
  }
});

router.get('/scheduler/dispatcher/status', (req, res) => {
  res.json({
    dispatcher: researchOpsRunner.getDispatcherState(),
    runner: {
      running: researchOpsRunner.getRunningState(),
    },
    refreshedAt: new Date().toISOString(),
  });
});

router.get('/runner/running', (req, res) => {
  res.json({ items: researchOpsRunner.getRunningState() });
});

// Daemons
router.post('/daemons/register', async (req, res) => {
  try {
    const daemon = await researchOpsStore.registerDaemon(getUserId(req), req.body || {});
    return res.status(201).json({
      serverId: daemon.id,
      hostname: daemon.hostname,
      status: daemon.status,
      heartbeatAt: daemon.heartbeatAt,
    });
  } catch (error) {
    console.error('[ResearchOps] registerDaemon failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to register daemon') });
  }
});

router.post('/daemons/heartbeat', async (req, res) => {
  try {
    const daemon = await researchOpsStore.heartbeatDaemon(getUserId(req), req.body || {});
    if (!daemon) return res.status(404).json({ error: 'Server not found for heartbeat' });
    return res.json({
      serverId: daemon.id,
      hostname: daemon.hostname,
      status: daemon.status,
      heartbeatAt: daemon.heartbeatAt,
    });
  } catch (error) {
    console.error('[ResearchOps] heartbeatDaemon failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update heartbeat') });
  }
});

router.get('/daemons', async (req, res) => {
  try {
    const items = await researchOpsStore.listDaemons(getUserId(req), {
      limit: parseLimit(req.query.limit, 100, 300),
    });
    return res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listDaemons failed:', error);
    return res.status(500).json({ error: 'Failed to list daemons' });
  }
});

router.get('/cluster/resource-pool', async (req, res) => {
  try {
    const userId = getUserId(req);
    const staleAfterSec = Number(req.query.staleAfterSec);
    const staleAfterMs = Number.isFinite(staleAfterSec) && staleAfterSec > 0
      ? Math.floor(staleAfterSec * 1000)
      : 90 * 1000;
    const [daemons, queuedRuns, runningRuns, provisioningRuns] = await Promise.all([
      researchOpsStore.listDaemons(userId, { limit: 500 }),
      researchOpsStore.listQueue(userId, { limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'RUNNING', limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'PROVISIONING', limit: 1000 }),
    ]);
    const dispatcher = researchOpsRunner.getDispatcherState();
    const runnerProcesses = researchOpsRunner.getRunningState();
    const activeRuns = [...runningRuns, ...provisioningRuns];
    const queueByServer = new Map();
    queuedRuns.forEach((run) => {
      const sid = String(run.serverId || '').trim() || 'local-default';
      queueByServer.set(sid, (queueByServer.get(sid) || 0) + 1);
    });
    const activeByServer = new Map();
    activeRuns.forEach((run) => {
      const sid = String(run.serverId || '').trim() || 'local-default';
      activeByServer.set(sid, (activeByServer.get(sid) || 0) + 1);
    });
    const runnerByServer = new Map();
    runnerProcesses.forEach((item) => {
      const sid = String(item.serverId || '').trim() || 'local-default';
      runnerByServer.set(sid, (runnerByServer.get(sid) || 0) + 1);
    });
    const daemonById = new Map();

    const servers = daemons.map((daemon) => {
      const status = deriveDaemonStatus(daemon, { staleAfterMs });
      const gpu = extractGpuCapacity(daemon.capacity);
      const cpuMemory = extractCpuMemoryCapacity(daemon.capacity);
      const serverId = String(daemon.id || '');
      daemonById.set(serverId, daemon);
      return {
        serverId,
        hostname: daemon.hostname,
        status,
        registration: 'daemon',
        labels: daemon.labels || {},
        heartbeatAt: daemon.heartbeatAt || null,
        concurrencyLimit: Number(daemon.concurrencyLimit) || 1,
        queuedRuns: queueByServer.get(serverId) || 0,
        activeRuns: activeByServer.get(serverId) || 0,
        runnerProcesses: runnerByServer.get(serverId) || 0,
        resources: {
          gpu,
          cpuMemoryGb: cpuMemory,
        },
      };
    });

    const knownServerIds = new Set(servers.map((item) => String(item.serverId || '').trim()));
    if (!knownServerIds.has('local-default')) {
      const localQueued = queueByServer.get('local-default') || 0;
      const localActive = activeByServer.get('local-default') || 0;
      const localRunner = runnerByServer.get('local-default') || 0;
      servers.push({
        serverId: 'local-default',
        hostname: 'embedded-runner',
        status: 'ONLINE',
        registration: 'embedded',
        labels: { role: 'embedded-runner' },
        heartbeatAt: new Date().toISOString(),
        concurrencyLimit: Math.max(Number(dispatcher?.unregisteredConcurrency) || 1, 1),
        queuedRuns: localQueued,
        activeRuns: localActive,
        runnerProcesses: localRunner,
        resources: {
          gpu: { total: 0, available: 0 },
          cpuMemoryGb: { total: 0, available: 0 },
        },
      });
      knownServerIds.add('local-default');
    }

    const discoveredServerIds = new Set([
      ...Array.from(queueByServer.keys()),
      ...Array.from(activeByServer.keys()),
      ...Array.from(runnerByServer.keys()),
    ]);
    discoveredServerIds.forEach((sidRaw) => {
      const sid = String(sidRaw || '').trim() || 'local-default';
      if (!sid || knownServerIds.has(sid) || daemonById.has(sid)) return;
      const activeCount = activeByServer.get(sid) || 0;
      const queuedCount = queueByServer.get(sid) || 0;
      servers.push({
        serverId: sid,
        hostname: `${sid} (unregistered)`,
        status: activeCount > 0 ? 'ONLINE' : 'UNREGISTERED',
        registration: 'adhoc',
        labels: { role: 'unregistered-server' },
        heartbeatAt: null,
        concurrencyLimit: Math.max(Number(dispatcher?.unregisteredConcurrency) || 1, 1),
        queuedRuns: queuedCount,
        activeRuns: activeCount,
        runnerProcesses: runnerByServer.get(sid) || 0,
        resources: {
          gpu: { total: 0, available: 0 },
          cpuMemoryGb: { total: 0, available: 0 },
        },
      });
      knownServerIds.add(sid);
    });

    servers.sort((a, b) => String(a.serverId || '').localeCompare(String(b.serverId || '')));

    const aggregate = servers.reduce((acc, item) => {
      if (item.status === 'ONLINE' || item.status === 'DRAINING') {
        acc.gpuTotal += item.resources.gpu.total;
        acc.gpuAvailable += item.resources.gpu.available;
        acc.cpuMemoryTotalGb += item.resources.cpuMemoryGb.total;
        acc.cpuMemoryAvailableGb += item.resources.cpuMemoryGb.available;
      }
      acc.queueDepth += item.queuedRuns;
      acc.activeRuns += item.activeRuns;
      if (item.status === 'ONLINE') acc.onlineServers += 1;
      if (item.status === 'OFFLINE') acc.offlineServers += 1;
      if (item.status === 'DRAINING') acc.drainingServers += 1;
      if (item.status === 'UNREGISTERED') acc.unregisteredServers += 1;
      return acc;
    }, {
      gpuTotal: 0,
      gpuAvailable: 0,
      cpuMemoryTotalGb: 0,
      cpuMemoryAvailableGb: 0,
      queueDepth: 0,
      activeRuns: 0,
      onlineServers: 0,
      offlineServers: 0,
      drainingServers: 0,
      unregisteredServers: 0,
    });

    return res.json({
      aggregate,
      servers,
      dispatcher,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] cluster resource-pool failed:', error);
    return res.status(500).json({ error: 'Failed to load cluster resource pool' });
  }
});

router.get('/cluster/agent-capacity', async (req, res) => {
  try {
    const userId = getUserId(req);
    const [runningRuns, provisioningRuns] = await Promise.all([
      researchOpsStore.listRuns(userId, { status: 'RUNNING', limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'PROVISIONING', limit: 1000 }),
    ]);
    const { defaultLimit, parsed } = parseProviderConcurrencyLimits();
    const allRuns = [...runningRuns, ...provisioningRuns].filter((run) => run.runType === 'AGENT');
    const activeByProvider = new Map();
    allRuns.forEach((run) => {
      const provider = String(run.provider || 'codex_cli').trim() || 'codex_cli';
      activeByProvider.set(provider, (activeByProvider.get(provider) || 0) + 1);
    });

    const providerKeys = new Set([
      ...Object.keys(parsed),
      ...Array.from(activeByProvider.keys()),
      'codex_cli',
      'claude_code_cli',
      'gemini_cli',
    ]);
    const providers = Array.from(providerKeys).sort().map((provider) => {
      const active = activeByProvider.get(provider) || 0;
      const maxConcurrent = parsed[provider] || defaultLimit;
      return {
        provider,
        activeSessions: active,
        maxConcurrent,
        availableSessions: Math.max(maxConcurrent - active, 0),
      };
    });

    const totals = providers.reduce((acc, item) => {
      acc.activeSessions += item.activeSessions;
      acc.maxConcurrent += item.maxConcurrent;
      acc.availableSessions += item.availableSessions;
      return acc;
    }, {
      activeSessions: 0,
      maxConcurrent: 0,
      availableSessions: 0,
    });

    return res.json({
      totals,
      providers,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] cluster agent-capacity failed:', error);
    return res.status(500).json({ error: 'Failed to load agent capacity' });
  }
});

// Experiment runner bridge
router.post('/experiments/execute', async (req, res) => {
  const experimentRunnerUrl = String(process.env.EXPERIMENT_RUNNER_URL || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const serverId = String(req.body?.serverId || '').trim() || 'local-default';
  const command = String(req.body?.command || '').trim();
  const args = Array.isArray(req.body?.args) ? req.body.args : [];

  if (!projectId || !command) {
    return res.status(400).json({ error: 'projectId and command are required' });
  }

  if (experimentRunnerUrl) {
    try {
      const result = await withTimeout(
        async (signal) => {
          const response = await fetch(`${experimentRunnerUrl.replace(/\/$/, '')}/v1/experiments/execute`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req.body || {}),
            signal,
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`Experiment service ${response.status}: ${text}`);
          return JSON.parse(text);
        },
        20000
      );
      return res.json(result);
    } catch (error) {
      console.error('[ResearchOps] Experiment proxy failed:', error);
      return res.status(502).json({ error: sanitizeError(error, 'Experiment service unavailable') });
    }
  }

  try {
    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId,
      runType: 'EXPERIMENT',
      metadata: {
        command,
        args,
        cwd: String(req.body?.cwd || '').trim() || undefined,
        timeoutMs: Number(req.body?.timeoutMs) > 0 ? Number(req.body.timeoutMs) : undefined,
      },
    });

    await researchOpsRunner.executeRun(getUserId(req), run);

    return res.status(202).json({
      mode: 'local-backend-runner',
      run,
    });
  } catch (error) {
    console.error('[ResearchOps] Local experiment execution failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to execute experiment') });
  }
});

module.exports = router;
