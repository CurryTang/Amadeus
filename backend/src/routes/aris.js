const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createArisService } = require('../services/aris.service');

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

module.exports = router;
