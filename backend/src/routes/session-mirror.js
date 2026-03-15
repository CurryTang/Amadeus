const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const sessionMirror = require('../services/session-mirror.service');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB max audio
});

// All routes require auth
router.use(requireAuth);

// ─── Paginated past sessions (all servers or filtered) ────────────────────────

router.get('/sessions', async (req, res) => {
  try {
    const { serverId, limit, cursor } = req.query;
    const result = await sessionMirror.listPastSessions({
      serverId: serverId ? Number(serverId) : null,
      limit: Math.min(Number(limit) || 20, 100),
      cursor: cursor || null,
    });
    res.json(result);
  } catch (error) {
    console.error('[session-mirror] past-sessions error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Resume a stopped session ─────────────────────────────────────────────────

router.post('/sessions/:sessionId/resume', async (req, res) => {
  try {
    const session = await sessionMirror.resumeSession(req.params.sessionId);
    res.json(session);
  } catch (error) {
    console.error('[session-mirror] resume error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── List sessions for a server ───────────────────────────────────────────────

router.get('/servers/:serverId/sessions', async (req, res) => {
  try {
    const sessions = await sessionMirror.listSessions(Number(req.params.serverId));
    res.json({ sessions });
  } catch (error) {
    console.error('[session-mirror] list error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Create a new session on a server ─────────────────────────────────────────

router.post('/servers/:serverId/sessions', async (req, res) => {
  try {
    const { agentType, cwd, label, prompt } = req.body || {};
    const session = await sessionMirror.createSession(Number(req.params.serverId), {
      agentType,
      cwd,
      label,
      prompt,
    });
    res.status(201).json(session);
  } catch (error) {
    console.error('[session-mirror] create error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Get session detail ───────────────────────────────────────────────────────

router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await sessionMirror.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    console.error('[session-mirror] get error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Kill a session ───────────────────────────────────────────────────────────

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const result = await sessionMirror.killSession(req.params.sessionId);
    res.json(result);
  } catch (error) {
    console.error('[session-mirror] kill error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Refresh session metadata ─────────────────────────────────────────────────

router.post('/sessions/:sessionId/refresh', async (req, res) => {
  try {
    const session = await sessionMirror.refreshSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (error) {
    console.error('[session-mirror] refresh error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ─── Audio transcription ──────────────────────────────────────────────────────

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

    // Build multipart form for Whisper API
    const FormData = (await import('formdata-node')).FormData;
    const { Blob } = (await import('buffer'));
    const form = new FormData();
    form.set('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), 'audio.webm');
    form.set('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: `Whisper API error: ${errorText}` });
    }

    const data = await response.json();
    res.json({ text: data.text || '', refinedPrompt: data.text || '' });
  } catch (error) {
    console.error('[session-mirror] transcribe error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
