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

router.get('/runs', requireAuth, async (req, res) => {
  try {
    const runs = await arisService.listRuns();
    res.json({ runs });
  } catch (error) {
    console.error('[ARIS] runs error:', error);
    res.status(500).json({ error: 'Failed to load ARIS runs' });
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

module.exports = router;
