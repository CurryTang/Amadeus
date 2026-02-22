const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const researchOpsStore = require('../services/researchops/store');
const researchOpsRunner = require('../services/researchops/runner');

function parseLimit(raw, fallback = 50, max = 300) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function getUserId(req) {
  return req.userId || 'czk';
}

function sanitizeError(error, fallback) {
  return error?.message || fallback;
}

async function withTimeout(promiseFactory, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

router.use(requireAuth);

router.get('/health', async (req, res) => {
  try {
    await researchOpsStore.initStore();
    res.json({
      status: 'ok',
      storeMode: researchOpsStore.getStoreMode(),
      running: researchOpsRunner.getRunningState().length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to initialize ResearchOps store',
      message: sanitizeError(error),
    });
  }
});

// Projects
router.get('/projects', async (req, res) => {
  try {
    const items = await researchOpsStore.listProjects(getUserId(req), {
      limit: parseLimit(req.query.limit, 50, 200),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listProjects failed:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const project = await researchOpsStore.createProject(getUserId(req), {
      name: req.body?.name,
      description: req.body?.description,
    });
    res.status(201).json({ project });
  } catch (error) {
    console.error('[ResearchOps] createProject failed:', error);
    res.status(400).json({ error: sanitizeError(error, 'Failed to create project') });
  }
});

router.get('/projects/:projectId', async (req, res) => {
  try {
    const project = await researchOpsStore.getProject(getUserId(req), req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.json({ project });
  } catch (error) {
    console.error('[ResearchOps] getProject failed:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Ideas
router.get('/ideas', async (req, res) => {
  try {
    const items = await researchOpsStore.listIdeas(getUserId(req), {
      projectId: String(req.query.projectId || '').trim(),
      status: String(req.query.status || '').trim().toUpperCase(),
      limit: parseLimit(req.query.limit, 80, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listIdeas failed:', error);
    res.status(500).json({ error: 'Failed to list ideas' });
  }
});

router.post('/ideas', async (req, res) => {
  try {
    const idea = await researchOpsStore.createIdea(getUserId(req), req.body || {});
    res.status(201).json({ idea });
  } catch (error) {
    console.error('[ResearchOps] createIdea failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create idea') });
  }
});

router.get('/ideas/:ideaId', async (req, res) => {
  try {
    const idea = await researchOpsStore.getIdea(getUserId(req), req.params.ideaId);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json({ idea });
  } catch (error) {
    console.error('[ResearchOps] getIdea failed:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
  }
});

// Runs + Queue
router.post('/runs/enqueue', async (req, res) => {
  try {
    const run = await researchOpsStore.enqueueRun(getUserId(req), req.body || {});
    res.status(201).json({ run });
  } catch (error) {
    console.error('[ResearchOps] enqueueRun failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to enqueue run') });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const items = await researchOpsStore.listRuns(getUserId(req), {
      projectId: String(req.query.projectId || '').trim(),
      status: String(req.query.status || '').trim().toUpperCase(),
      limit: parseLimit(req.query.limit, 80, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listRuns failed:', error);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] getRun failed:', error);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

router.post('/runs/:runId/status', async (req, res) => {
  try {
    const run = await researchOpsStore.updateRunStatus(
      getUserId(req),
      req.params.runId,
      req.body?.status,
      req.body?.message,
      req.body?.payload
    );
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] updateRunStatus failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update run status') });
  }
});

router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const run = await researchOpsRunner.cancelRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] cancelRun failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to cancel run') });
  }
});

router.post('/runs/:runId/events', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!events.length) return res.status(400).json({ error: 'events must be a non-empty array' });
    const items = await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, events);
    return res.status(201).json({ count: items.length, items });
  } catch (error) {
    console.error('[ResearchOps] publishRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to publish run events') });
  }
});

router.get('/runs/:runId/events', async (req, res) => {
  try {
    const result = await researchOpsStore.listRunEvents(getUserId(req), req.params.runId, {
      afterSequence: req.query.afterSequence,
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run events') });
  }
});

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
    const result = await researchOpsStore.recoverStaleRuns(getUserId(req), {
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

// Skills
router.get('/skills', async (req, res) => {
  try {
    const items = await researchOpsStore.listSkills();
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listSkills failed:', error);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

// KB bridge
router.post('/kb/search', async (req, res) => {
  const kbServiceUrl = String(process.env.KB_SERVICE_URL || '').trim();
  const query = String(req.body?.query || '').trim();
  const topK = parseLimit(req.body?.topK, 5, 30);

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  if (kbServiceUrl) {
    try {
      const result = await withTimeout(
        async (signal) => {
          const response = await fetch(`${kbServiceUrl.replace(/\/$/, '')}/v1/kb/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, top_k: topK }),
            signal,
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`KB service ${response.status}: ${text}`);
          return JSON.parse(text);
        },
        12000
      );
      return res.json(result);
    } catch (error) {
      console.error('[ResearchOps] KB proxy failed:', error);
      return res.status(502).json({ error: sanitizeError(error, 'KB service unavailable') });
    }
  }

  // Lightweight fallback over ideas/projects metadata.
  try {
    const [ideas, projects] = await Promise.all([
      researchOpsStore.listIdeas(getUserId(req), { limit: 200 }),
      researchOpsStore.listProjects(getUserId(req), { limit: 200 }),
    ]);

    const q = query.toLowerCase();
    const ideaHits = ideas
      .filter((idea) =>
        `${idea.title}\n${idea.hypothesis}\n${idea.summary || ''}`.toLowerCase().includes(q)
      )
      .slice(0, topK)
      .map((idea) => ({
        kind: 'idea',
        id: idea.id,
        title: idea.title,
        text: idea.hypothesis,
      }));

    const projectHits = projects
      .filter((project) =>
        `${project.name}\n${project.description || ''}`.toLowerCase().includes(q)
      )
      .slice(0, Math.max(0, topK - ideaHits.length))
      .map((project) => ({
        kind: 'project',
        id: project.id,
        title: project.name,
        text: project.description || '',
      }));

    return res.json({
      source: 'fallback-metadata',
      items: [...ideaHits, ...projectHits],
    });
  } catch (error) {
    console.error('[ResearchOps] KB fallback failed:', error);
    return res.status(500).json({ error: 'Failed to perform fallback KB search' });
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
