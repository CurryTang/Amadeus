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

    const content = lines.join('\n');
    res.json({ content, projectName: project.name });
  } catch (error) {
    console.error('[ARIS] generate claude-md error:', error);
    res.status(500).json({ error: 'Failed to generate CLAUDE.md' });
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

module.exports = router;
