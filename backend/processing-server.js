/**
 * Desktop Processing Server
 *
 * This server runs on your desktop and handles all heavy LLM processing.
 * It receives requests from the DO server via FRP tunnel.
 *
 * Usage:
 *   node processing-server.js
 */

require('dotenv').config();
const express = require('express');
const config = require('./src/config');
const { initDatabase } = require('./src/db');

// Import processing services
const readerService = require('./src/services/reader.service');
const codeAnalysisService = require('./src/services/code-analysis.service');
const llmService = require('./src/services/llm.service');
const geminiCliService = require('./src/services/gemini-cli.service');
const pdfService = require('./src/services/pdf.service');
const projectInsightsService = require('./src/services/project-insights.service');
const paperTrackerService = require('./src/services/paper-tracker.service');
const twitterPlaywrightTracker = require('./src/services/twitter-playwright-tracker.service');
const agentSessionWatcher = require('./src/services/agent-session-watcher.service');

const app = express();
const PORT = process.env.PROCESSING_PORT || 3001;

// Middleware
app.use(express.json({ limit: '50mb' }));

function clampInteger(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Desktop Processing Server',
    timestamp: new Date().toISOString(),
    geminiCliAvailable: geminiCliService.isAvailable ? 'checking...' : false,
  });
});

// Check Gemini CLI availability for health endpoint
geminiCliService.isAvailable().then((available) => {
  console.log(`[Processing] Gemini CLI available: ${available}`);
});

/**
 * Process a document (PDF to notes)
 * POST /api/process/document
 * Body: { item: {...}, options: {...} }
 */
app.post('/api/process/document', async (req, res) => {
  try {
    const { item, options } = req.body;

    if (!item || !item.documentId) {
      return res.status(400).json({ error: 'Invalid request: missing item or documentId' });
    }

    console.log(`[Processing] Document request: ${item.title} (ID: ${item.documentId})`);

    const result = await readerService.processDocument(item, options);

    res.json(result);
  } catch (error) {
    console.error('[Processing] Document processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Analyze code repository
 * POST /api/process/code-analysis
 * Body: { documentId, codeUrl, title }
 */
app.post('/api/process/code-analysis', async (req, res) => {
  try {
    const { documentId, codeUrl, title } = req.body;

    if (!documentId || !codeUrl) {
      return res.status(400).json({ error: 'Invalid request: missing documentId or codeUrl' });
    }

    console.log(`[Processing] Code analysis request: ${title} (${codeUrl})`);

    const result = await codeAnalysisService.performAnalysis(documentId, codeUrl, title);

    res.json(result);
  } catch (error) {
    console.error('[Processing] Code analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Generate LLM completion
 * POST /api/process/llm
 * Body: { content, prompt, provider }
 */
app.post('/api/process/llm', async (req, res) => {
  try {
    const { content, prompt, provider = 'gemini' } = req.body;

    if (!content || !prompt) {
      return res.status(400).json({ error: 'Invalid request: missing content or prompt' });
    }

    console.log(`[Processing] LLM request: ${provider}, content length: ${content.length}`);

    const result = await llmService.generateCompletion(content, prompt, provider);

    res.json(result);
  } catch (error) {
    console.error('[Processing] LLM generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Read PDF with Gemini CLI
 * POST /api/process/read-pdf
 * Body: { filePath, prompt }
 */
app.post('/api/process/read-pdf', async (req, res) => {
  try {
    const { filePath, prompt } = req.body;

    if (!filePath || !prompt) {
      return res.status(400).json({ error: 'Invalid request: missing filePath or prompt' });
    }

    console.log(`[Processing] PDF read request: ${filePath}`);

    const result = await geminiCliService.readDocument(filePath, prompt);

    res.json(result);
  } catch (error) {
    console.error('[Processing] PDF reading error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Run all tracker sources in background
 * POST /api/tracker/run
 */
app.post('/api/tracker/run', async (req, res) => {
  try {
    paperTrackerService.runAll().catch((e) => {
      console.error('[Processing] Tracker run error:', e);
    });
    res.json({ ok: true, message: 'Tracker run started on local executor' });
  } catch (error) {
    console.error('[Processing] Tracker run request error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Run one tracker source in background
 * POST /api/tracker/sources/:id/run
 */
app.post('/api/tracker/sources/:id/run', async (req, res) => {
  try {
    const sourceId = Number(req.params.id);
    const sources = await paperTrackerService.getSources();
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    paperTrackerService.runSourceAndMark(source).catch((e) => {
      console.error(`[Processing] Tracker source ${sourceId} run error:`, e);
    });
    res.json({ ok: true, message: `Tracker source "${source.name}" run started on local executor` });
  } catch (error) {
    console.error('[Processing] Tracker source run request error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Tracker status from local executor
 * GET /api/tracker/status
 */
app.get('/api/tracker/status', async (req, res) => {
  try {
    res.json(paperTrackerService.getStatus());
  } catch (error) {
    console.error('[Processing] Tracker status request error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Twitter Playwright tracker preview on local executor
 * POST /api/tracker/twitter/playwright/preview
 */
app.post('/api/tracker/twitter/playwright/preview', async (req, res) => {
  try {
    const result = await twitterPlaywrightTracker.extractLatestPaperPosts(req.body || {});
    res.json(result);
  } catch (error) {
    console.error('[Processing] Tracker twitter preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check whether a local project path exists on the executor
 * POST /api/researchops/insights/path-check
 * Body: { projectPath }
 */
app.post('/api/researchops/insights/path-check', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const result = await projectInsightsService.checkLocalProjectPath(projectPath);
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project path-check insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to check project path' });
  }
});

/**
 * Ensure a local project path exists on the executor
 * POST /api/researchops/insights/ensure-path
 * Body: { projectPath }
 */
app.post('/api/researchops/insights/ensure-path', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const result = await projectInsightsService.ensureLocalProjectPath(projectPath);
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project ensure-path insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to ensure project path' });
  }
});

/**
 * Ensure a local project path is a git repository on the executor
 * POST /api/researchops/insights/ensure-git
 * Body: { projectPath }
 */
app.post('/api/researchops/insights/ensure-git', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const result = await projectInsightsService.ensureLocalGitRepository(projectPath);
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project ensure-git insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to ensure project git repository' });
  }
});

/**
 * Load project git progress for a local path on the executor
 * POST /api/researchops/insights/git-log
 * Body: { projectPath, limit }
 */
app.post('/api/researchops/insights/git-log', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const limit = clampInteger(req.body?.limit, 30, 1, 120);
    const branch = String(req.body?.branch || '').trim();
    const result = await projectInsightsService.loadLocalProjectGitProgress(projectPath, limit, { branch });
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project git-log insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to load project git log' });
  }
});

/**
 * Load top-level project file snapshot for a local path on the executor
 * POST /api/researchops/insights/server-files
 * Body: { projectPath, sampleLimit }
 */
app.post('/api/researchops/insights/server-files', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const sampleLimit = clampInteger(req.body?.sampleLimit, 48, 1, 120);
    const result = await projectInsightsService.loadLocalProjectFiles(projectPath, sampleLimit);
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project server-files insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to load project files' });
  }
});

/**
 * Load git changed files (+/- lines) for a local path on the executor
 * POST /api/researchops/insights/changed-files
 * Body: { projectPath, limit }
 */
app.post('/api/researchops/insights/changed-files', async (req, res) => {
  try {
    const projectPath = String(req.body?.projectPath || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    const limit = clampInteger(req.body?.limit, 200, 1, 1000);
    const result = await projectInsightsService.loadLocalProjectChangedFiles(projectPath, limit);
    return res.json(result);
  } catch (error) {
    console.error('[Processing] Project changed-files insight error:', error);
    return res.status(400).json({ error: error.message || 'Failed to load project changed files' });
  }
});

/**
 * Agent sessions observed from local Claude Code / Codex session files
 * GET /api/agent-sessions?projectPath=...
 */
app.get('/api/agent-sessions', (req, res) => {
  try {
    const projectPath = String(req.query.projectPath || '').trim();
    const items = projectPath
      ? agentSessionWatcher.getSessionsByPath(projectPath)
      : agentSessionWatcher.getAllSessions();
    res.json({ items });
  } catch (error) {
    console.error('[Processing] agent-sessions error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('[Processing] Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
async function startServer() {
  try {
    await initDatabase();
    console.log('[Processing] Connected to Turso database');

    // Clean up temp files on startup
    await pdfService.cleanupAllTmpFiles();
    console.log('[Processing] Cleaned up temp files');

    if (config.tracker?.enabled) {
      const trackerIntervalMs = parseInt(process.env.TRACKER_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10);
      paperTrackerService.start(trackerIntervalMs);
      console.log(`[Processing] Paper tracker scheduler started locally (${trackerIntervalMs / 3600000}h interval)`);
    } else {
      console.log('[Processing] Paper tracker scheduler disabled on local executor');
    }

    agentSessionWatcher.start();

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[Processing] Desktop Processing Server running on port ${PORT}`);
      console.log(`[Processing] Ready to accept requests from DO server via FRP`);
      console.log(`[Processing] Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    console.error('[Processing] Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Processing] Shutting down gracefully...');
  agentSessionWatcher.stop();
  paperTrackerService.stop();
  await pdfService.cleanupAllTmpFiles();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Processing] Received SIGTERM, shutting down...');
  agentSessionWatcher.stop();
  paperTrackerService.stop();
  await pdfService.cleanupAllTmpFiles();
  process.exit(0);
});

startServer();
