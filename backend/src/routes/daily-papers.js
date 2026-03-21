const express = require('express');
const { requireAuth } = require('../middleware/auth');
const dailyPaperService = require('../services/daily-paper.service');

const router = express.Router();

// GET /api/daily-papers/config
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await dailyPaperService.getConfig();
    res.json({ config });
  } catch (error) {
    console.error('[DailyPaper] config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/daily-papers/config
router.put('/config', requireAuth, async (req, res) => {
  try {
    const config = await dailyPaperService.updateConfig(req.body);
    res.json({ config });
  } catch (error) {
    console.error('[DailyPaper] update config error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/daily-papers/today
router.get('/today', requireAuth, async (req, res) => {
  try {
    const selection = await dailyPaperService.getDailySelection(req.query.date);
    res.json({ selection });
  } catch (error) {
    console.error('[DailyPaper] today error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/daily-papers/select — manually trigger selection
router.post('/select', requireAuth, async (req, res) => {
  try {
    const { date, k } = req.body;
    const selection = await dailyPaperService.selectDailyPapers(date, k);
    res.json({ selection });
  } catch (error) {
    console.error('[DailyPaper] select error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/daily-papers/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 14;
    const history = await dailyPaperService.getHistory(limit);
    res.json({ history });
  } catch (error) {
    console.error('[DailyPaper] history error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
