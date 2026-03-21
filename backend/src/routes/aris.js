const express = require('express');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/auth');
const { createArisService } = require('../services/aris.service');
const documentService = require('../services/document.service');
const researchPackService = require('../services/research-pack.service');
const s3Service = require('../services/s3.service');
const arxivService = require('../services/arxiv.service');

const planService = require('../services/arisPlan.service');

const router = express.Router();
const arisService = createArisService();

function getArisUserContext(req = {}) {
  return { username: req.userId || 'czk' };
}

function classifyArisError(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return 500;
  if (
    message.includes('required')
    || message.includes('invalid')
    || message.includes('validation')
    || message.includes('wake-up')
    || message.includes('wakeup')
    || message.includes('must')
  ) {
    return 400;
  }
  if (
    message.includes('not found')
    || message.includes('does not exist')
    || message.includes('missing')
  ) {
    return 404;
  }
  return 500;
}

async function invokeArisMethod(methodName, args = []) {
  const method = arisService[methodName];
  if (typeof method !== 'function') {
    throw new Error(`ARIS service method ${methodName} is not implemented`);
  }
  return method.call(arisService, ...args);
}

router.get('/context', requireAuth, async (req, res) => {
  try {
    const payload = await arisService.getWorkspaceContext({
      username: req.userId || 'czk',
    });
    res.json(payload);
  } catch (error) {
    console.error('[ARIS] context error:', error);
    res.status(500).json({ error: 'Failed to load ARIS workspace context' });
  }
});

router.get('/control-tower', requireAuth, async (req, res) => {
  try {
    const controlTower = await arisService.getControlTower(getArisUserContext(req));
    res.json({ controlTower: controlTower || { projects: [], overdueWakeups: [], reviewReadyRuns: [], blockedWorkItems: [], staleRuns: [], milestones: [] } });
  } catch (error) {
    console.error('[ARIS] control tower error:', error);
    // Always return a usable response — control tower should never 404
    res.json({ controlTower: { projects: [], overdueWakeups: [], reviewReadyRuns: [], blockedWorkItems: [], staleRuns: [], milestones: [] } });
  }
});

router.get('/projects', requireAuth, async (req, res) => {
  try {
    const projects = await arisService.listProjects();
    res.json({ projects });
  } catch (error) {
    console.error('[ARIS] list projects error:', error);
    res.status(500).json({ error: 'Failed to load ARIS projects' });
  }
});

router.post('/projects', requireAuth, async (req, res) => {
  try {
    const project = await arisService.createProject(req.body || {}, {
      username: req.userId || 'czk',
    });
    res.status(201).json({ project });
  } catch (error) {
    const status = /required|invalid|not found/i.test(String(error.message || '')) ? 400 : 500;
    console.error('[ARIS] create project error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS project' });
  }
});

router.patch('/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const project = await arisService.updateProject(req.params.projectId, req.body || {}, {
      username: req.userId || 'czk',
    });
    res.json({ project });
  } catch (error) {
    const status = /required|invalid/i.test(String(error.message || ''))
      ? 400
      : (/not found/i.test(String(error.message || '')) ? 404 : 500);
    console.error('[ARIS] update project error:', error);
    res.status(status).json({ error: error.message || 'Failed to update ARIS project' });
  }
});

router.delete('/projects/:projectId', requireAuth, async (req, res) => {
  try {
    const project = await arisService.deleteProject(req.params.projectId, {
      username: req.userId || 'czk',
    });
    res.json({ project });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] delete project error:', error);
    res.status(status).json({ error: error.message || 'Failed to delete ARIS project' });
  }
});

router.get('/projects/:projectId/targets', requireAuth, async (req, res) => {
  try {
    const targets = await arisService.listTargets(req.params.projectId);
    res.json({ targets });
  } catch (error) {
    console.error('[ARIS] list targets error:', error);
    res.status(500).json({ error: 'Failed to load ARIS targets' });
  }
});

router.post('/projects/:projectId/targets', requireAuth, async (req, res) => {
  try {
    const target = await arisService.createTarget(req.params.projectId, req.body || {}, {
      username: req.userId || 'czk',
    });
    res.status(201).json({ target });
  } catch (error) {
    const status = /required|invalid|not found/i.test(String(error.message || '')) ? 400 : 500;
    console.error('[ARIS] create target error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS target' });
  }
});

router.patch('/targets/:targetId', requireAuth, async (req, res) => {
  try {
    const target = await arisService.updateTarget(req.params.targetId, req.body || {}, {
      username: req.userId || 'czk',
    });
    res.json({ target });
  } catch (error) {
    const status = /required|invalid/i.test(String(error.message || ''))
      ? 400
      : (/not found/i.test(String(error.message || '')) ? 404 : 500);
    console.error('[ARIS] update target error:', error);
    res.status(status).json({ error: error.message || 'Failed to update ARIS target' });
  }
});

router.delete('/targets/:targetId', requireAuth, async (req, res) => {
  try {
    const target = await arisService.deleteTarget(req.params.targetId, {
      username: req.userId || 'czk',
    });
    res.json({ target });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] delete target error:', error);
    res.status(status).json({ error: error.message || 'Failed to delete ARIS target' });
  }
});

// POST /api/aris/projects/:projectId/clone-targets-from/:sourceProjectId
// Clone all targets from another project. Handy when multiple projects share
// the same set of servers (e.g. Memory uses the same 6 servers as AutoRDL).
router.post('/projects/:projectId/clone-targets-from/:sourceProjectId', requireAuth, async (req, res) => {
  try {
    const result = await arisService.cloneTargetsFromProject(
      req.params.sourceProjectId,
      req.params.projectId,
      req.body || {},
    );
    res.status(201).json(result);
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] clone targets error:', error);
    res.status(status).json({ error: error.message || 'Failed to clone targets' });
  }
});

router.get('/projects/:projectId/claude-md', requireAuth, async (req, res) => {
  try {
    const projects = await arisService.listProjects();
    const project = projects.find((p) => p.id === req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const targets = await arisService.listTargets(req.params.projectId);
    const servers = await arisService.listServers();

    const lines = [];
    lines.push(`# ${project.name} — ARIS Project Config`);
    lines.push('');
    lines.push('> Auto-generated by ARIS. Do not edit manually — re-sync from the ARIS dashboard.');
    lines.push('');

    if (targets.length > 0) {
      lines.push('## Remote Targets');
      lines.push('');
      lines.push('| Server | SSH User | Proxy Jump | Remote Path |');
      lines.push('|--------|----------|------------|-------------|');
      for (const t of targets) {
        const srv = servers.find((s) => String(s.id) === String(t.sshServerId));
        const user = srv?.user || 'unknown';
        const jump = srv?.proxy_jump || '';
        lines.push(`| ${t.sshServerName} | ${user} | ${jump || '(direct)'} | ${t.remoteProjectPath} |`);
      }
      lines.push('');

      // Detailed per-target info
      lines.push('### Target Details');
      lines.push('');
      for (const t of targets) {
        const srv = servers.find((s) => String(s.id) === String(t.sshServerId));
        const user = srv?.user || 'unknown';
        const port = srv?.port || 22;
        const jump = srv?.proxy_jump || '';
        const sshCmd = jump
          ? `ssh -J ${jump} ${user}@${t.sshServerName}`
          : `ssh ${user}@${t.sshServerName}${port !== 22 ? ` -p ${port}` : ''}`;
        lines.push(`#### ${t.sshServerName}`);
        lines.push(`- SSH: \`${sshCmd}\``);
        lines.push(`- Project path: \`${t.remoteProjectPath}\``);
        if (t.remoteDatasetRoot) lines.push(`- Dataset root: \`${t.remoteDatasetRoot}\``);
        if (t.remoteCheckpointRoot) lines.push(`- Checkpoint root: \`${t.remoteCheckpointRoot}\``);
        if (t.remoteOutputRoot) lines.push(`- Output root: \`${t.remoteOutputRoot}\``);
        lines.push('');
      }
    }

    if (project.syncExcludes?.length > 0) {
      lines.push('## Sync Excludes');
      lines.push('');
      for (const ex of project.syncExcludes) {
        lines.push(`- ${ex}`);
      }
      lines.push('');
    }

    lines.push('## ARIS API');
    lines.push('');
    lines.push('Use these endpoints to interact with the ARIS project management system:');
    lines.push('');
    lines.push(`- **Base URL**: \`https://auto-reader.duckdns.org/api\``);
    lines.push(`- **Project ID**: \`${project.id}\``);
    lines.push(`- **Auth**: \`Authorization: Bearer <token>\` (stored in project \`.env\` as \`ARIS_TOKEN\`)`);
    lines.push('');
    lines.push('### Key Endpoints');
    lines.push('');
    lines.push(`- Upload plan: \`POST /aris/projects/${project.id}/plans\` body: \`{ title, content }\``);
    lines.push(`- List work items: \`GET /aris/projects/${project.id}/work-items\``);
    lines.push(`- Create work item: \`POST /aris/projects/${project.id}/work-items\` body: \`{ title, contextMd, type, status, milestoneId }\``);
    lines.push(`- Update work item: \`PATCH /aris/work-items/<id>\` body: \`{ status, contextMd, ... }\``);
    lines.push(`- List milestones: \`GET /aris/projects/${project.id}/milestones\``);
    lines.push('');

    const content = lines.join('\n');
    res.json({ content, projectName: project.name });
  } catch (error) {
    console.error('[ARIS] generate claude-md error:', error);
    res.status(500).json({ error: 'Failed to generate CLAUDE.md' });
  }
});

router.get('/projects/:projectId/work-items', requireAuth, async (req, res) => {
  try {
    const workItems = await invokeArisMethod('listProjectWorkItems', [
      req.params.projectId,
      getArisUserContext(req),
    ]);
    if (workItems == null) {
      return res.status(404).json({ error: 'ARIS project work items not found' });
    }
    res.json({ workItems });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] list project work items error:', error);
    res.status(status).json({ error: error.message || 'Failed to load ARIS work items' });
  }
});

router.post('/projects/:projectId/work-items', requireAuth, async (req, res) => {
  try {
    const workItem = await invokeArisMethod('createWorkItem', [
      req.params.projectId,
      req.body || {},
      getArisUserContext(req),
    ]);
    if (!workItem) {
      return res.status(404).json({ error: 'ARIS work item not found' });
    }
    res.status(201).json({ workItem });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] create work item error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS work item' });
  }
});

// ─── Milestone CRUD ─────────────────────────────────────────────────────────

router.get('/projects/:projectId/milestones', requireAuth, async (req, res) => {
  try {
    const milestones = await arisService.listMilestones(req.params.projectId);
    res.json({ milestones: milestones || [] });
  } catch (error) {
    console.error('[ARIS] list milestones error:', error);
    res.json({ milestones: [] });
  }
});

router.post('/projects/:projectId/milestones', requireAuth, async (req, res) => {
  try {
    const milestone = await arisService.createMilestone(req.params.projectId, req.body || {});
    res.status(201).json({ milestone });
  } catch (error) {
    const status = /required|invalid/i.test(String(error.message || '')) ? 400 : 500;
    console.error('[ARIS] create milestone error:', error);
    res.status(status).json({ error: error.message || 'Failed to create milestone' });
  }
});

router.patch('/milestones/:milestoneId', requireAuth, async (req, res) => {
  try {
    const existing = await arisService.getMilestoneById(req.params.milestoneId);
    if (!existing) return res.status(404).json({ error: 'Milestone not found' });
    const updated = { ...existing, ...req.body, id: existing.id, updatedAt: new Date().toISOString() };
    await arisService.saveMilestone(updated);
    res.json({ milestone: updated });
  } catch (error) {
    console.error('[ARIS] update milestone error:', error);
    res.status(500).json({ error: error.message || 'Failed to update milestone' });
  }
});

router.delete('/milestones/:milestoneId', requireAuth, async (req, res) => {
  try {
    await arisService.deleteMilestone(req.params.milestoneId);
    res.json({ ok: true });
  } catch (error) {
    console.error('[ARIS] delete milestone error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete milestone' });
  }
});

// Upload a plan/document to the project as a work item under a "Plans & Docs" phase
router.post('/projects/:projectId/plans', requireAuth, async (req, res) => {
  try {
    const { title, content, type = 'plan', milestoneId, status = 'backlog' } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!content) return res.status(400).json({ error: 'content is required' });

    const projectId = req.params.projectId;
    let targetMilestoneId = milestoneId;

    // If no milestoneId, auto-create or find "Plans & Docs" phase
    if (!targetMilestoneId) {
      const milestones = await arisService.listMilestones(projectId);
      let planPhase = milestones.find((m) => m.name === 'Plans & Docs');
      if (!planPhase) {
        planPhase = await arisService.createMilestone(projectId, {
          name: 'Plans & Docs',
          description: 'Implementation plans, design docs, and research notes',
        });
      }
      targetMilestoneId = planPhase.id;
    }

    const workItem = await arisService.createWorkItem(projectId, {
      title,
      contextMd: content,
      type: type || 'plan',
      status,
      milestoneId: targetMilestoneId,
    }, { username: req.userId || 'czk' });

    res.status(201).json({ workItem, milestoneId: targetMilestoneId });
  } catch (error) {
    console.error('[ARIS] upload plan error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload plan' });
  }
});

// Seed default ML research phases for a project
router.post('/projects/:projectId/seed-phases', requireAuth, async (req, res) => {
  try {
    const defaultPhases = [
      { name: 'Data Preparation', description: 'Dataset collection, preprocessing, feature engineering' },
      { name: 'Model Architecture', description: 'Backbone design, module implementation, architecture search' },
      { name: 'Training & Experiments', description: 'Training runs, hyperparameter tuning, ablation studies' },
      { name: 'Analysis & Evaluation', description: 'Results analysis, benchmarking, visualization' },
      { name: 'Paper Writing', description: 'Draft writing, figures, related work, submission prep' },
    ];
    const milestones = [];
    for (const phase of defaultPhases) {
      const milestone = await arisService.createMilestone(req.params.projectId, phase);
      milestones.push(milestone);
    }
    res.status(201).json({ milestones });
  } catch (error) {
    console.error('[ARIS] seed phases error:', error);
    res.status(500).json({ error: error.message || 'Failed to seed phases' });
  }
});

router.get('/work-items/:workItemId', requireAuth, async (req, res) => {
  try {
    const workItem = await invokeArisMethod('getWorkItem', [
      req.params.workItemId,
      getArisUserContext(req),
    ]);
    if (!workItem) {
      return res.status(404).json({ error: 'ARIS work item not found' });
    }
    res.json({ workItem });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] get work item error:', error);
    res.status(status).json({ error: error.message || 'Failed to load ARIS work item' });
  }
});

router.patch('/work-items/:workItemId', requireAuth, async (req, res) => {
  try {
    const workItem = await invokeArisMethod('updateWorkItem', [
      req.params.workItemId,
      req.body || {},
      getArisUserContext(req),
    ]);
    if (!workItem) {
      return res.status(404).json({ error: 'ARIS work item not found' });
    }
    res.json({ workItem });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] update work item error:', error);
    res.status(status).json({ error: error.message || 'Failed to update ARIS work item' });
  }
});

router.post('/work-items/:workItemId/runs', requireAuth, async (req, res) => {
  try {
    const run = await invokeArisMethod('createWorkItemRun', [
      req.params.workItemId,
      req.body || {},
      getArisUserContext(req),
    ]);
    if (!run) {
      return res.status(404).json({ error: 'ARIS run not found' });
    }
    res.status(201).json({ run });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] create work item run error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS run' });
  }
});

router.post('/runs/:runId/wakeups', requireAuth, async (req, res) => {
  try {
    const wakeup = await invokeArisMethod('createRunWakeup', [
      req.params.runId,
      req.body || {},
      getArisUserContext(req),
    ]);
    if (!wakeup) {
      return res.status(404).json({ error: 'ARIS wake-up not found' });
    }
    res.status(201).json({ wakeup });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] create wakeup error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS wakeup' });
  }
});

router.get('/review-inbox', requireAuth, async (req, res) => {
  try {
    const reviewInbox = await arisService.listReviewInbox(getArisUserContext(req));
    res.json({ reviewInbox: reviewInbox || [] });
  } catch (error) {
    console.error('[ARIS] review inbox error:', error);
    res.json({ reviewInbox: [] });
  }
});

router.post('/runs/:runId/reviews', requireAuth, async (req, res) => {
  try {
    const review = await invokeArisMethod('createReview', [
      req.params.runId,
      req.body || {},
      getArisUserContext(req),
    ]);
    if (!review) {
      return res.status(404).json({ error: 'ARIS review not found' });
    }
    res.status(201).json({ review });
  } catch (error) {
    const status = classifyArisError(error);
    console.error('[ARIS] create review error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS review' });
  }
});

router.get('/projects/:projectId/now', requireAuth, async (req, res) => {
  try {
    const now = await invokeArisMethod('getProjectNow', [
      req.params.projectId,
      getArisUserContext(req),
    ]);
    res.json({ now: now || { project: null, milestones: [], activeWorkItems: [], upcomingWakeups: [] } });
  } catch (error) {
    console.error('[ARIS] project now error:', error);
    res.json({ now: { project: null, milestones: [], activeWorkItems: [], upcomingWakeups: [] } });
  }
});

router.get('/runs', requireAuth, async (req, res) => {
  try {
    const runs = await arisService.listRuns();
    res.json({ runs });
  } catch (error) {
    console.error('[ARIS] runs error:', error);
    res.status(500).json({ error: 'Failed to load ARIS runs' });
  }
});

router.get('/runs/:runId', requireAuth, async (req, res) => {
  try {
    const run = await arisService.getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ error: 'ARIS run not found' });
    }
    res.json({ run });
  } catch (error) {
    console.error('[ARIS] get run error:', error);
    res.status(500).json({ error: 'Failed to load ARIS run' });
  }
});

router.post('/runs', requireAuth, async (req, res) => {
  try {
    const launch = await arisService.createLaunchRequest(req.body || {}, {
      username: req.userId || 'czk',
    });
    res.status(201).json({ run: launch });
  } catch (error) {
    const status = /required|invalid/i.test(String(error.message || '')) ? 400 : 500;
    console.error('[ARIS] create run error:', error);
    res.status(status).json({ error: error.message || 'Failed to create ARIS run' });
  }
});

// Register a run initiated externally (e.g. from Claude Code CLI).
// Does NOT dispatch via SSH — just records the run in the DB.
router.post('/runs/register', requireAuth, async (req, res) => {
  try {
    const run = await arisService.registerExternalRun(req.body || {});
    res.status(201).json({ run });
  } catch (error) {
    const status = /required|invalid/i.test(String(error.message || '')) ? 400 : 500;
    console.error('[ARIS] register run error:', error);
    res.status(status).json({ error: error.message || 'Failed to register ARIS run' });
  }
});

// Update an existing run's status/result (e.g. CLI reporting completion).
router.patch('/runs/:runId/status', requireAuth, async (req, res) => {
  try {
    const run = await arisService.updateRunStatus(req.params.runId, req.body || {});
    res.json({ run });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] update run status error:', error);
    res.status(status).json({ error: error.message || 'Failed to update run status' });
  }
});

router.post('/runs/:runId/retry', requireAuth, async (req, res) => {
  try {
    const launch = await arisService.retryRun(req.params.runId, {
      username: req.userId || 'czk',
    });
    res.status(201).json({ run: launch });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] retry run error:', error);
    res.status(status).json({ error: error.message || 'Failed to retry ARIS run' });
  }
});

router.post('/runs/:runId/actions', requireAuth, async (req, res) => {
  try {
    const action = await arisService.createRunAction(req.params.runId, req.body || {}, {
      username: req.userId || 'czk',
    });
    res.status(201).json({ action });
  } catch (error) {
    const message = error.message || 'Failed to create ARIS run action';
    const status = /not found/i.test(String(message))
      ? 404
      : (/required|invalid/i.test(String(message)) ? 400 : 500);
    console.error('[ARIS] create run action error:', error);
    res.status(status).json({ error: message });
  }
});

// ─── Plan endpoints ──────────────────────────────────────────────────────────

// POST /api/aris/runs/:runId/plan — parse markdown and create plan nodes
router.post('/runs/:runId/plan', requireAuth, async (req, res) => {
  try {
    const { markdown } = req.body || {};
    if (!markdown) return res.status(400).json({ error: 'markdown is required' });

    const nodes = planService.parsePlanMarkdown(markdown);
    if (nodes.length === 0) return res.status(400).json({ error: 'No plan nodes found in markdown' });

    await planService.savePlanNodes(req.params.runId, nodes);
    const saved = await planService.getPlanNodes(req.params.runId);
    const tree = planService.buildPlanTree(saved);
    res.status(201).json({ plan: tree });
  } catch (error) {
    console.error('[ARIS] create plan error:', error);
    res.status(500).json({ error: error.message || 'Failed to create plan' });
  }
});

// GET /api/aris/runs/:runId/plan — get plan tree
router.get('/runs/:runId/plan', requireAuth, async (req, res) => {
  try {
    const nodes = await planService.getPlanNodes(req.params.runId);
    const tree = planService.buildPlanTree(nodes);
    res.json({ plan: tree });
  } catch (error) {
    console.error('[ARIS] get plan error:', error);
    res.status(500).json({ error: error.message || 'Failed to load plan' });
  }
});

// PATCH /api/aris/runs/:runId/plan/:nodeKey — update a plan node's status
router.patch('/runs/:runId/plan/:nodeKey', requireAuth, async (req, res) => {
  try {
    const node = await planService.updatePlanNode(req.params.runId, req.params.nodeKey, req.body || {});
    if (!node) return res.status(404).json({ error: 'Plan node not found' });
    res.json({ node });
  } catch (error) {
    console.error('[ARIS] update plan node error:', error);
    res.status(500).json({ error: error.message || 'Failed to update plan node' });
  }
});

// POST /api/aris/runs/:runId/plan/:nodeKey/reject — reject a node, cascade reset dependents
router.post('/runs/:runId/plan/:nodeKey/reject', requireAuth, async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await planService.rejectNode(req.params.runId, req.params.nodeKey, reason || '');
    if (!result) return res.status(404).json({ error: 'Plan node not found' });

    // Return updated tree
    const nodes = await planService.getPlanNodes(req.params.runId);
    const tree = planService.buildPlanTree(nodes);
    res.json({ ...result, plan: tree });
  } catch (error) {
    console.error('[ARIS] reject plan node error:', error);
    res.status(500).json({ error: error.message || 'Failed to reject plan node' });
  }
});

// GET /api/aris/projects/:projectId/files
// Returns generated project files (CLAUDE.md managed block, skills).
// Client applies these locally with `materializeProjectFiles`.
router.get('/projects/:projectId/files', requireAuth, async (req, res) => {
  try {
    const files = await arisService.getProjectFiles(req.params.projectId);
    res.json({ files });
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] get project files error:', error);
    res.status(status).json({ error: error.message || 'Failed to get project files' });
  }
});

// ─── Review reports endpoints ─────────────────────────────────────────────────

// POST /api/aris/runs/:runId/review-reports
// Called by the remote auto-review-loop after completion to push review/ files.
// Body: { "TODO-1.1.md": "<base64_or_plain_content>", ... }
// If values are base64-encoded, they are decoded before saving.
router.post('/runs/:runId/review-reports', requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Body must be a { filename: content } object' });
    }
    // Decode base64 values if they look encoded (no newlines, high entropy)
    const reports = {};
    for (const [filename, value] of Object.entries(body)) {
      if (typeof value !== 'string') continue;
      try {
        const decoded = Buffer.from(value, 'base64').toString('utf8');
        // Heuristic: if decoded text looks like markdown, use it; otherwise keep raw
        reports[filename] = /^#|^-|\n/.test(decoded) ? decoded : value;
      } catch (_) {
        reports[filename] = value;
      }
    }
    const result = await arisService.saveRunReviewReports(req.params.runId, reports);
    res.json(result);
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] save review reports error:', error);
    res.status(status).json({ error: error.message || 'Failed to save review reports' });
  }
});

// GET /api/aris/runs/:runId/review-reports
// Returns all review reports from the project's local review/ folder.
// Response: { reports: [{ filename, content }] }
router.get('/runs/:runId/review-reports', requireAuth, async (req, res) => {
  try {
    const result = await arisService.getRunReviewReports(req.params.runId);
    res.json(result);
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] get review reports error:', error);
    res.status(status).json({ error: error.message || 'Failed to get review reports' });
  }
});

// GET /api/aris/projects/:projectId/gpu-status
// Query all SSH servers linked to this project's targets for GPU availability.
router.get('/projects/:projectId/gpu-status', requireAuth, async (req, res) => {
  try {
    const result = await arisService.getProjectGpuStatus(req.params.projectId);
    res.json(result);
  } catch (error) {
    const status = /not found/i.test(String(error.message || '')) ? 404 : 500;
    console.error('[ARIS] gpu-status error:', error);
    res.status(status).json({ error: error.message || 'Failed to query GPU status' });
  }
});

// POST /api/aris/projects/:projectId/import-papers
// Download papers (by tag) into the project's local resource/ folder.
// Body: { tag: string, sourceType?: 'pdf'|'latex', includeCode?: boolean }
// Each paper gets its own subfolder: resource/<sanitized_title>/
router.post('/projects/:projectId/import-papers', requireAuth, async (req, res) => {
  try {
    const { projectId } = req.params;
    const { tag, sourceType = 'pdf', includeCode = true } = req.body;

    if (!tag) {
      return res.status(400).json({ error: 'tag is required' });
    }

    // Look up the project to find localFullPath
    const allProjects = await arisService.listProjects();
    const project = allProjects.find((p) => p.id === projectId);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const localPath = project.localFullPath || project.localProjectPath;
    if (!localPath) {
      return res.status(400).json({ error: 'Project has no local path configured. Set a full local path in project settings.' });
    }

    const resourceDir = path.join(localPath, 'resource');

    // Fetch documents with the given tag (up to 100)
    const { documents: docList } = await documentService.getDocuments(
      { userId: req.userId || 'czk', tags: [tag] },
      { page: 1, limit: 100 },
      { sort: 'createdAt', order: 'desc' }
    );

    if (!docList || docList.length === 0) {
      return res.status(404).json({ error: `No papers found with tag "${tag}"` });
    }

    // Fetch full details (with s3Key, notesS3Key etc.) for each document
    const documents = (await Promise.all(
      docList.map((d) => documentService.getDocumentById(d.id))
    )).filter(Boolean);

    // Ensure resource/ directory exists
    fs.mkdirSync(resourceDir, { recursive: true });

    const results = [];

    for (const doc of documents) {
      const sanitizedTitle = doc.title
        .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s-]/g, '')
        .replace(/\s+/g, '_')
        .substring(0, 80);
      const paperDir = path.join(resourceDir, sanitizedTitle);
      fs.mkdirSync(paperDir, { recursive: true });

      const paperResult = { id: doc.id, title: doc.title, folder: sanitizedTitle, files: [] };

      // 1. Download PDF
      try {
        if (doc.s3Key) {
          const buffer = await s3Service.downloadBuffer(doc.s3Key);
          const pdfPath = path.join(paperDir, 'paper.pdf');
          fs.writeFileSync(pdfPath, buffer);
          paperResult.files.push('paper.pdf');
        } else if (doc.originalUrl) {
          // Try fetching from URL
          const https = require('https');
          const buffer = await new Promise((resolve, reject) => {
            const fetchWithRedirect = (url, count = 0) => {
              if (count > 5) { reject(new Error('Too many redirects')); return; }
              https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (response) => {
                if ([301, 302, 303, 307].includes(response.statusCode) && response.headers.location) {
                  const loc = response.headers.location;
                  fetchWithRedirect(loc.startsWith('http') ? loc : new URL(loc, url).href, count + 1);
                  return;
                }
                if (response.statusCode !== 200) { reject(new Error(`HTTP ${response.statusCode}`)); return; }
                const chunks = [];
                response.on('data', (c) => chunks.push(c));
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
              }).on('error', reject);
            };
            fetchWithRedirect(doc.originalUrl);
          });
          const pdfPath = path.join(paperDir, 'paper.pdf');
          fs.writeFileSync(pdfPath, buffer);
          paperResult.files.push('paper.pdf');
        }
      } catch (err) {
        console.warn(`[ARIS ImportPapers] Failed PDF for "${doc.title}": ${err.message}`);
      }

      // 2. Download LaTeX source (if arXiv and sourceType is latex)
      if (sourceType === 'latex' && doc.originalUrl) {
        const arxivId = arxivService.parseArxivUrl(doc.originalUrl);
        if (arxivId) {
          try {
            const buffer = await researchPackService.fetchArxivSource(arxivId);
            const texPath = path.join(paperDir, 'latex_source.tar.gz');
            fs.writeFileSync(texPath, buffer);
            paperResult.files.push('latex_source.tar.gz');
          } catch (err) {
            console.warn(`[ARIS ImportPapers] Failed LaTeX for "${doc.title}": ${err.message}`);
          }
        }
      }

      // 3. Download source code (if present)
      if (includeCode && doc.codeUrl) {
        try {
          const { buffer, repoName } = await researchPackService.fetchGitHubRepoZip(doc.codeUrl);
          const codeDir = path.join(paperDir, 'code');
          fs.mkdirSync(codeDir, { recursive: true });
          const codePath = path.join(codeDir, `${repoName}.zip`);
          fs.writeFileSync(codePath, buffer);
          paperResult.files.push(`code/${repoName}.zip`);
        } catch (err) {
          console.warn(`[ARIS ImportPapers] Failed code for "${doc.title}": ${err.message}`);
        }
      }

      // 4. Download AI notes (if present)
      if (doc.notesS3Key) {
        try {
          const buffer = await s3Service.downloadBuffer(doc.notesS3Key);
          const notesPath = path.join(paperDir, 'notes.md');
          fs.writeFileSync(notesPath, buffer);
          paperResult.files.push('notes.md');
        } catch (err) {
          console.warn(`[ARIS ImportPapers] Failed notes for "${doc.title}": ${err.message}`);
        }
      }

      results.push(paperResult);
    }

    const totalFiles = results.reduce((sum, r) => sum + r.files.length, 0);
    console.log(`[ARIS ImportPapers] Imported ${results.length} papers (${totalFiles} files) to ${resourceDir}`);

    res.json({
      message: `Imported ${results.length} papers to ${resourceDir}`,
      resourceDir,
      papers: results,
    });
  } catch (error) {
    console.error('[ARIS] import-papers error:', error);
    res.status(500).json({ error: error.message || 'Failed to import papers' });
  }
});

// ─── Local Claude Code session monitoring ─────────────────────────────────────

// In-memory store for session snapshots (ephemeral — resets on restart)
let localSessionSnapshot = { sessions: [], updatedAt: null };
// Cache AI-generated session summaries by matched JSONL filename
const sessionSummaryCache = new Map();

// Generate a short AI summary for a session using Codex CLI (free with account)
async function generateSessionSummary(rawContext, matchedFile) {
  if (!rawContext || sessionSummaryCache.has(matchedFile)) {
    return sessionSummaryCache.get(matchedFile) || '';
  }
  try {
    const codexService = require('../services/codex-cli.service');
    const prompt = `Summarize this Claude Code conversation in 5-8 words. Be specific about the task. Return ONLY the summary, no quotes, no explanation.\n\n${rawContext}`;
    const result = await codexService.runCodex(prompt, { timeout: 30000 });
    const summary = (result.text || '').trim().substring(0, 80);
    if (summary) sessionSummaryCache.set(matchedFile, summary);
    return summary;
  } catch (e) {
    console.warn('[ARIS] session summary generation failed:', e.message);
    return '';
  }
}

// POST /api/aris/local-sessions — push a snapshot of running Claude Code sessions
// Called periodically by a local monitor script on the user's Mac
router.post('/local-sessions', requireAuth, async (req, res) => {
  try {
    const { sessions = [] } = req.body || {};
    // Match sessions to ARIS projects by cwd -> localFullPath
    const projects = await arisService.listProjects();
    const enriched = await Promise.all(sessions.map(async (s) => {
      const cwdLower = (s.cwd || '').toLowerCase();
      const project = projects.find((p) => {
        const fp = (p.localFullPath || p.localProjectPath || '').toLowerCase();
        return fp && cwdLower && (cwdLower === fp || cwdLower.startsWith(fp + '/'));
      });
      // AI-generate session name if missing but rawContext available
      let sessionName = s.sessionName || '';
      if (!sessionName && s.rawContext && s._matchedFile) {
        sessionName = await generateSessionSummary(s.rawContext, s._matchedFile);
      }
      return {
        ...s,
        sessionName,
        rawContext: undefined, // don't store raw context in snapshot
        projectId: project?.id || null,
        projectName: project?.name || null,
      };
    }));
    localSessionSnapshot = { sessions: enriched, updatedAt: new Date().toISOString() };
    res.json({ ok: true, count: enriched.length });
  } catch (error) {
    console.error('[ARIS] local-sessions push error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/aris/local-sessions — retrieve the latest snapshot
router.get('/local-sessions', requireAuth, async (req, res) => {
  res.json(localSessionSnapshot);
});

module.exports = router;
