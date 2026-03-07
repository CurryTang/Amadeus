'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;
const { getDb } = require('../../db');
const codexCliService = require('../../services/codex-cli.service');
const geminiCliService = require('../../services/gemini-cli.service');
const llmService = require('../../services/llm.service');
const researchOpsStore = require('../../services/researchops/store');
const {
  buildIdeaListPayload,
  buildIdeaPayload,
} = require('../../services/researchops/idea-payload.service');
const { buildDashboardPayload } = require('../../services/researchops/dashboard-payload.service');
const { buildQueueListPayload } = require('../../services/researchops/queue-payload.service');
const {
  buildSkillContentPayload,
  buildSkillListPayload,
  buildSkillSyncPayload,
} = require('../../services/researchops/skill-payload.service');
const {
  buildGeneratedPlanPayload,
  buildEnqueuedPlanPayload,
} = require('../../services/researchops/plan-payload.service');
const { buildKbSearchPayload } = require('../../services/researchops/kb-search-payload.service');
const { normalizeEnqueueRunPayload } = require('../../services/researchops/enqueue-run-payload.service');
const workflowSchemaService = require('../../services/researchops/workflow-schema.service');
const planAgentService = require('../../services/researchops/plan-agent.service');
const todoGeneratorService = require('../../services/researchops/todo-generator.service');
const { parseLimit, cleanString, getUserId, sanitizeError } = require('./shared');

const CHATDSE_ENFORCED_HOST = 'compute.example.edu';
const CHATDSE_PROJECT_ROOT = '/egr/research-dselab/testuser';

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

function promiseWithTimeout(promise, timeoutMs = 30000, label = 'Operation') {
  const limit = Number(timeoutMs);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${limit}ms`));
    }, limit);
    if (typeof timer?.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function parseJsonArrayFromModelOutput(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function normalizeTodoCandidate(item = {}, index = 0) {
  const title = String(item?.title || '').trim();
  if (!title) return null;
  return {
    id: `todo_${String(index + 1).padStart(2, '0')}`,
    title,
    details: String(item?.details || '').trim(),
    hypothesis: String(item?.details || item?.hypothesis || '').trim() || title,
    priority: ['high', 'medium', 'low'].includes(String(item?.priority || '').toLowerCase())
      ? String(item.priority).toLowerCase()
      : 'medium',
  };
}

function fallbackTodoCandidatesFromInstruction(instruction = '', project = null) {
  const goal = String(instruction || '').trim();
  const projectName = String(project?.name || '').trim();
  const prefix = projectName ? `[${projectName}] ` : '';
  return [
    {
      id: 'todo_01',
      title: `${prefix}Review and understand the current state`,
      details: `Analyze the existing codebase and understand the context for: ${goal}`,
      hypothesis: `Understanding the existing state will clarify what needs to be done for: ${goal}`,
      priority: 'high',
    },
    {
      id: 'todo_02',
      title: `${prefix}Plan and implement: ${goal.slice(0, 60)}`,
      details: goal,
      hypothesis: goal,
      priority: 'high',
    },
    {
      id: 'todo_03',
      title: `${prefix}Test and validate the implementation`,
      details: `Verify that the implementation meets the requirements for: ${goal}`,
      hypothesis: `Validation ensures the implementation is correct for: ${goal}`,
      priority: 'medium',
    },
  ];
}

async function generateTodoCandidatesFromInstruction({ instruction = '', project = null } = {}) {
  const goal = String(instruction || '').trim();
  if (!goal) return [];
  const projectName = String(project?.name || '').trim();
  const projectDescription = String(project?.description || '').trim();
  const projectPath = String(project?.projectPath || '').trim();
  const timeoutRaw = Number(process.env.RESEARCHOPS_TODO_GENERATION_TIMEOUT_MS || 45000);
  const generationTimeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(10000, Math.min(Math.floor(timeoutRaw), 120000))
    : 45000;
  const modelTimeoutMs = Math.max(8000, generationTimeoutMs - 5000);
  const prompt = [
    'You are a research project planner.',
    'Generate an actionable TODO list from the instruction below.',
    'Return ONLY a JSON array with no markdown.',
    'Each item schema:',
    '{"title":"...", "details":"...", "priority":"high|medium|low"}',
    'Rules:',
    '- 6 to 10 tasks',
    '- concrete and domain-specific (no generic placeholders)',
    '- each task should be executable in one run/session',
    '- order tasks by dependency',
    '- avoid tasks that require future conclusions before prerequisite runs exist',
    projectName ? `Project: ${projectName}` : '',
    projectDescription ? `Project description: ${projectDescription}` : '',
    projectPath ? `Project path: ${projectPath}` : '',
  ].filter(Boolean).join('\n');

  let modelText = '';
  try {
    const modelTextRaw = await promiseWithTimeout((async () => {
      if (await codexCliService.isAvailable()) {
        const result = await codexCliService.readMarkdown(goal, prompt, { timeout: modelTimeoutMs });
        return String(result?.text || '').trim();
      }
      if (await geminiCliService.isAvailable()) {
        const result = await geminiCliService.readMarkdown(goal, prompt, { timeout: modelTimeoutMs });
        return String(result?.text || '').trim();
      }
      const result = await promiseWithTimeout(
        llmService.generateWithFallback(goal, prompt),
        modelTimeoutMs,
        'TODO generation fallback LLM'
      );
      return String(result?.text || '').trim();
    })(), generationTimeoutMs, 'TODO generation');
    modelText = String(modelTextRaw || '').trim();
  } catch (error) {
    console.warn('[ResearchOps] instruction todo generation via agent failed:', error.message);
    modelText = '';
  }

  const parsed = parseJsonArrayFromModelOutput(modelText);
  const normalized = parsed
    .map((item, index) => normalizeTodoCandidate(item, index))
    .filter(Boolean)
    .slice(0, 10);
  if (normalized.length > 0) return normalized;

  return fallbackTodoCandidatesFromInstruction(goal, project);
}

router.get('/dashboard', async (req, res) => {
  try {
    const userId = getUserId(req);
    const projectLimit = parseLimit(req.query.projectLimit, 80, 300);
    const itemLimit = parseLimit(req.query.itemLimit, 120, 400);
    const [projects, ideas, queue, runs, skills] = await Promise.all([
      researchOpsStore.listProjects(userId, { limit: projectLimit }),
      researchOpsStore.listIdeas(userId, { limit: itemLimit }),
      researchOpsStore.listQueue(userId, { limit: itemLimit }),
      researchOpsStore.listRuns(userId, { limit: itemLimit }),
      researchOpsStore.listSkills(userId),
    ]);
    return res.json(buildDashboardPayload({
      projects,
      ideas,
      queue,
      runs,
      skills,
      projectLimit,
      itemLimit,
      refreshedAt: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[ResearchOps] dashboard failed:', error);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

router.get('/ideas', async (req, res) => {
  try {
    const projectId = String(req.query.projectId || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();
    const limit = parseLimit(req.query.limit, 80, 300);
    const items = await researchOpsStore.listIdeas(getUserId(req), {
      projectId,
      status,
      limit,
    });
    res.json(buildIdeaListPayload({
      items,
      projectId,
      status,
      limit,
    }));
  } catch (error) {
    console.error('[ResearchOps] listIdeas failed:', error);
    res.status(500).json({ error: 'Failed to list ideas' });
  }
});

router.post('/ideas', async (req, res) => {
  try {
    const idea = await researchOpsStore.createIdea(getUserId(req), req.body || {});
    res.status(201).json(buildIdeaPayload({ idea }));
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
    return res.json(buildIdeaPayload({ idea }));
  } catch (error) {
    console.error('[ResearchOps] getIdea failed:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
  }
});

router.patch('/ideas/:ideaId', async (req, res) => {
  try {
    const idea = await researchOpsStore.updateIdea(getUserId(req), req.params.ideaId, req.body || {});
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json(buildIdeaPayload({ idea }));
  } catch (error) {
    console.error('[ResearchOps] updateIdea failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update idea') });
  }
});

router.post('/plan/generate', async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || '').trim();
    const instructionType = String(req.body?.instructionType || '').trim();
    const todoMode = req.body?.todoMode === true || String(req.body?.output || '').trim().toLowerCase() === 'todos';
    const projectId = String(req.body?.projectId || '').trim();
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }
    let project = null;
    if (projectId) {
      project = await researchOpsStore.getProject(getUserId(req), projectId);
    }
    if (todoMode) {
      let server = null;
      if (project && cleanString(project.locationType).toLowerCase() === 'ssh') {
        const sid = cleanString(project.serverId);
        if (sid) server = await getSshServerById(sid);
      }
      const generated = await todoGeneratorService.generateTodoDslPackage({
        userId: getUserId(req),
        instruction,
        project,
        server,
      });
      const todoCandidates = Array.isArray(generated.todoCandidates)
        ? generated.todoCandidates
        : await generateTodoCandidatesFromInstruction({ instruction, project });
      const plan = {
        plan_id: `todo_${Date.now()}`,
        instruction_type: 'todo_dsl',
        goal: instruction,
        nodes: (Array.isArray(generated.treeNodes) && generated.treeNodes.length > 0
          ? generated.treeNodes
          : todoCandidates.map((item, index) => ({
            id: `todo_${String(index + 1).padStart(2, '0')}`,
            title: item.title,
            kind: 'experiment',
            assumption: [],
            target: [item.hypothesis],
            commands: [],
            checks: [{ name: 'manual_review', type: 'manual_approve' }],
            tags: [cleanString(item.priority) || 'medium', 'todo-generator'],
          }))
        ).map((node, index) => ({
          id: cleanString(node?.id) || `todo_${String(index + 1).padStart(2, '0')}`,
          label: cleanString(node?.title) || cleanString(node?.label) || `Planned step ${index + 1}`,
          description: cleanString(node?.ui?.todo_dsl_step?.objective) || cleanString(node?.description) || '',
          priority: cleanString(node?.priority)
            || cleanString(node?.ui?.todo_dsl_step?.priority)
            || cleanString(todoCandidates[index]?.priority)
            || 'medium',
          node,
        })),
        edges: [],
        workflow: [],
        generated_at: new Date().toISOString(),
      };
      return res.json(buildGeneratedPlanPayload({
        plan,
        todoCandidates,
        todoDsl: generated.todoDsl || null,
        referenceSummary: generated.referenceSummary || null,
      }));
    }
    const plan = planAgentService.generatePlan({ instruction, instructionType });
    return res.json(buildGeneratedPlanPayload({ plan }));
  } catch (error) {
    console.error('[ResearchOps] plan generate failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate plan') });
  }
});

router.post('/plan/enqueue-v2', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const instruction = String(body.instruction || '').trim();
    const projectId = String(body.projectId || '').trim();
    const runType = String(body.runType || 'AGENT').trim().toUpperCase() || 'AGENT';
    const serverId = String(body.serverId || '').trim() || 'local-default';
    const provider = String(body.provider || 'codex_cli').trim() || 'codex_cli';
    if (!instruction) return res.status(400).json({ error: 'instruction is required' });
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    await enforceExperimentProjectPathPolicy(getUserId(req), projectId, runType);

    const plan = planAgentService.generatePlan({
      instruction,
      instructionType: String(body.instructionType || '').trim(),
    });
    const workflow = workflowSchemaService.normalizeAndValidateWorkflow(plan.workflow, { allowEmpty: false });

    const normalizedPlanRun = normalizeEnqueueRunPayload({
      projectId,
      serverId,
      runType,
      provider,
      schemaVersion: '2.0',
      mode: String(body.mode || 'headless').trim().toLowerCase() === 'interactive' ? 'interactive' : 'headless',
      workflow,
      contextRefs: body.contextRefs && typeof body.contextRefs === 'object' ? body.contextRefs : {},
      outputContract: body.outputContract,
      budgets: body.budgets && typeof body.budgets === 'object' ? body.budgets : {},
      hitlPolicy: body.hitlPolicy && typeof body.hitlPolicy === 'object' ? body.hitlPolicy : {},
      metadata: {
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
        plan: {
          planId: plan.plan_id,
          instructionType: plan.instruction_type,
          resourceEstimate: plan.resource_estimate,
          riskNotes: plan.risk_notes,
        },
      },
    });
    const run = await researchOpsStore.enqueueRun(getUserId(req), normalizedPlanRun);
    return res.status(201).json(buildEnqueuedPlanPayload({ plan, run }));
  } catch (error) {
    console.error('[ResearchOps] plan enqueue-v2 failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate and enqueue plan') });
  }
});

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
      return res.json(buildKbSearchPayload({ query, topK, result }));
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

    return res.json(buildKbSearchPayload({
      query,
      topK,
      result: {
        source: 'fallback-metadata',
        items: [...ideaHits, ...projectHits],
      },
    }));
  } catch (error) {
    console.error('[ResearchOps] KB fallback failed:', error);
    return res.status(500).json({ error: 'Failed to perform fallback KB search' });
  }
});

router.get('/skills', async (req, res) => {
  try {
    const items = await researchOpsStore.listSkills(getUserId(req));
    res.json(buildSkillListPayload({ items }));
  } catch (error) {
    console.error('[ResearchOps] listSkills failed:', error);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

router.post('/skills/sync', async (req, res) => {
  try {
    const result = await researchOpsStore.syncLocalSkillsToRemote(getUserId(req));
    return res.json(buildSkillSyncPayload({ result }));
  } catch (error) {
    console.error('[ResearchOps] syncLocalSkillsToRemote failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to sync skills to object storage') });
  }
});

const SKILLS_ROOT = path.join(__dirname, '..', '..', '..', '..', 'skills');

function resolveSkillMdPath(skillId) {
  const safeName = path.basename(cleanString(skillId || ''));
  if (!safeName) return null;
  return path.join(SKILLS_ROOT, safeName, 'SKILL.md');
}

router.get('/skills/:skillId/content', async (req, res) => {
  const mdPath = resolveSkillMdPath(req.params.skillId);
  if (!mdPath) return res.status(400).json({ error: 'Invalid skill id' });
  try {
    const content = await fs.readFile(mdPath, 'utf8');
    return res.json(buildSkillContentPayload({
      skillId: req.params.skillId,
      content,
    }));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Skill not found' });
    console.error('[ResearchOps] getSkillContent failed:', err);
    return res.status(500).json({ error: 'Failed to read skill' });
  }
});

router.put('/skills/:skillId/content', async (req, res) => {
  const mdPath = resolveSkillMdPath(req.params.skillId);
  if (!mdPath) return res.status(400).json({ error: 'Invalid skill id' });
  const { content } = req.body;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content must be a string' });
  try {
    await fs.mkdir(path.dirname(mdPath), { recursive: true });
    await fs.writeFile(mdPath, content, 'utf8');
    return res.json(buildSkillContentPayload({
      skillId: req.params.skillId,
      content,
      ok: true,
    }));
  } catch (err) {
    console.error('[ResearchOps] saveSkillContent failed:', err);
    return res.status(500).json({ error: 'Failed to save skill' });
  }
});

module.exports = router;
