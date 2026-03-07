'use strict';

const express = require('express');
const router = express.Router();
const autopilotService = require('../../services/researchops/autopilot.service');
const {
  buildAutopilotSessionListPayload,
  buildAutopilotSessionPayload,
} = require('../../services/researchops/autopilot-session-payload.service');
const { sanitizeError } = require('./shared');

router.post('/autopilot/:sessionId/stop', async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const session = await autopilotService.stopSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(buildAutopilotSessionPayload({ session }));
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error, 'Failed to stop autopilot session') });
  }
});

router.get('/autopilot/:sessionId', async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    const session = autopilotService.getSession(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    return res.json(buildAutopilotSessionPayload({ session }));
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error, 'Failed to get autopilot session') });
  }
});

module.exports = router;
