const express = require('express');
const router = express.Router();
const queueService = require('../services/queue.service');
const schedulerService = require('../services/scheduler.service');
const readerService = require('../services/reader.service');
const { requireAuth } = require('../middleware/auth');
const { sanitizeForClient } = require('../services/document.service');

function asTrimmedText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRefinementRounds(rounds) {
  if (!Array.isArray(rounds)) return null;

  const normalized = [];
  for (let i = 0; i < rounds.length; i++) {
    const round = rounds[i];
    if (!round) continue;

    if (typeof round === 'string') {
      const prompt = asTrimmedText(round);
      if (!prompt) continue;
      normalized.push({
        name: `Round ${i + 1}`,
        prompt,
        input: prompt,
        type: 'legacy',
        sourceUrl: '',
      });
      continue;
    }

    if (typeof round !== 'object') continue;

    const prompt = asTrimmedText(round.prompt) || asTrimmedText(round.input);
    if (!prompt) continue;

    const sourceUrl = asTrimmedText(round.sourceUrl);
    normalized.push({
      name: asTrimmedText(round.name) || `Round ${i + 1}`,
      prompt,
      input: asTrimmedText(round.input) || prompt,
      type: asTrimmedText(round.type) || (sourceUrl ? 'url' : 'created'),
      sourceUrl,
    });
  }

  return normalized;
}

/**
 * GET /api/reader/modes
 * Get available reader modes
 */
router.get('/modes', (req, res) => {
  res.json({
    modes: [
      {
        id: 'vanilla',
        name: 'Vanilla Summary',
        description: 'Basic paper summary with key points (English output)',
        features: ['Single pass', 'Key contributions', 'Methodology', 'Results'],
      },
      {
        id: 'auto_reader',
        name: 'Auto Reader',
        description: 'Multi-pass deep reading with code analysis (Chinese output)',
        features: [
          '3-pass paper reading',
          'Mathematical framework extraction',
          'Mermaid diagram generation',
          'Code repository analysis (if available)',
          '中文输出',
        ],
      },
      {
        id: 'auto_reader_v2',
        name: 'Auto Reader V2',
        description: 'Multi-pass deep reading with pre-rendered diagrams as images (Chinese output)',
        features: [
          '3-pass paper reading',
          'Mathematical framework extraction',
          'Pre-rendered SVG diagrams (Kroki + mermaid-cli)',
          'Diagram validation & auto-fix',
          'Code repository analysis (if available)',
          '中文输出',
        ],
      },
      {
        id: 'auto_reader_v3',
        name: 'Auto Reader V3 (Deep)',
        description: '2-pass deep analysis with minimal implementation and mathematical framework (Chinese output)',
        features: [
          '2-pass focused analysis',
          '表层分析: 任务定义、领域现状、输入输出规格',
          '深层分析: 最小复现代码、数学框架、批判性分析',
          'First-principles thinking',
          '可运行的简化代码实现',
          '中文输出',
        ],
      },
    ],
  });
});

/**
 * GET /api/reader/providers
 * Get available analysis providers
 */
router.get('/providers', async (req, res) => {
  try {
    const providers = await readerService.getAvailableProviders();
    res.json({
      providers,
      defaultProvider: 'codex-cli',
    });
  } catch (error) {
    console.error('Error getting providers:', error);
    res.status(500).json({ error: 'Failed to get providers' });
  }
});

/**
 * GET /api/reader/queue/status
 * Get the current queue status and rate limit info
 */
router.get('/queue/status', async (req, res) => {
  try {
    const status = await queueService.getQueueStatus();
    const schedulerStatus = schedulerService.getStatus();

    res.json({
      ...status,
      scheduler: schedulerStatus,
    });
  } catch (error) {
    console.error('Error getting queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

/**
 * POST /api/reader/queue/:documentId
 * Manually add a document to the processing queue (requires auth)
 * Body params:
 *   - priority: number (default 0)
 *   - readerMode: 'vanilla' | 'auto_reader' (default 'vanilla')
 *   - codeUrl: string (optional - URL to code repository)
 */
router.post('/queue/:documentId', requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { priority = 0, readerMode = 'auto_reader_v2', codeUrl, provider, refinementRounds, model, thinkingBudget } = req.body;
    if (refinementRounds !== undefined && !Array.isArray(refinementRounds)) {
      return res.status(400).json({ error: 'refinementRounds must be an array when provided' });
    }

    const normalizedRounds = normalizeRefinementRounds(refinementRounds);
    if (Array.isArray(refinementRounds) && refinementRounds.length > 0 && (!normalizedRounds || normalizedRounds.length === 0)) {
      return res.status(400).json({ error: 'No valid refinement rounds provided' });
    }

    // Update document with reader mode, provider, and code URL before queuing
    const { getDb } = require('../db');
    const db = getDb();

    const updates = ['reader_mode = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const args = [readerMode];

    if (codeUrl !== undefined) {
      updates.push('code_url = ?', 'has_code = ?');
      args.push(codeUrl || null, codeUrl ? 1 : 0);
    }

    if (provider) {
      updates.push('analysis_provider = ?');
      args.push(provider);
    }

    if (model !== undefined) {
      updates.push('analysis_model = ?');
      args.push(model || null);
    }

    if (thinkingBudget !== undefined) {
      updates.push('thinking_budget = ?');
      args.push(parseInt(thinkingBudget) || 0);
    }

    args.push(parseInt(documentId));

    await db.execute({
      sql: `UPDATE documents SET ${updates.join(', ')} WHERE id = ?`,
      args,
    });

    const result = await queueService.enqueueDocument(
      parseInt(documentId),
      priority,
      normalizedRounds && normalizedRounds.length > 0 ? normalizedRounds : null
    );

    res.json({
      ...result,
      readerMode,
      provider,
      codeUrl,
      refinementRounds: normalizedRounds || null,
    });
  } catch (error) {
    console.error('Error enqueueing document:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /api/reader/queue/:documentId
 * Remove a document from the processing queue (requires auth)
 */
router.delete('/queue/:documentId', requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { getDb } = require('../db');
    const db = getDb();

    // Remove from queue
    await db.execute({
      sql: 'DELETE FROM processing_queue WHERE document_id = ?',
      args: [parseInt(documentId)],
    });

    // Reset document status to idle
    await db.execute({
      sql: "UPDATE documents SET processing_status = 'idle', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND processing_status = 'queued'",
      args: [parseInt(documentId)],
    });

    res.json({ success: true, documentId: parseInt(documentId) });
  } catch (error) {
    console.error('Error removing document from queue:', error);
    res.status(500).json({ error: 'Failed to remove document from queue' });
  }
});

/**
 * POST /api/reader/process/:documentId
 * Trigger immediate processing of a document (bypasses scheduler, respects rate limit) (requires auth)
 * Query params:
 *   - force=true: Force reprocessing even if already completed
 * Body params:
 *   - provider: string (optional)
 *   - promptTemplateId: number (optional)
 *   - readerMode: 'vanilla' | 'auto_reader' (default from document or 'vanilla')
 *   - codeUrl: string (optional - URL to code repository)
 */
router.post('/process/:documentId', requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { provider, promptTemplateId, readerMode, codeUrl } = req.body;
    const force = req.query.force === 'true';

    // Check rate limit
    const canProcess = await queueService.canProcessMore();
    if (!canProcess) {
      return res.status(429).json({
        error: 'Rate limit exceeded',
        message: 'Maximum documents per hour reached. Please try again later.',
      });
    }

    // Get document info
    const { getDb } = require('../db');
    const db = getDb();

    const docResult = await db.execute({
      sql: 'SELECT id, title, s3_key, file_size, mime_type, processing_status, reader_mode, code_url, has_code FROM documents WHERE id = ?',
      args: [parseInt(documentId)],
    });

    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docResult.rows[0];

    if (doc.processing_status === 'processing' && !force) {
      return res.status(400).json({ error: 'Document is already being processed' });
    }

    if ((doc.processing_status === 'completed' || doc.processing_status === 'processing') && !force) {
      return res.status(400).json({ error: 'Document has already been processed. Use ?force=true to reprocess.' });
    }

    // Determine reader mode and code URL (request params override stored values)
    const effectiveReaderMode = readerMode || doc.reader_mode || 'vanilla';
    const effectiveCodeUrl = codeUrl || doc.code_url;
    const effectiveHasCode = effectiveCodeUrl ? 1 : (doc.has_code || 0);

    // Update document with reader mode if provided
    if (readerMode || codeUrl) {
      await db.execute({
        sql: `UPDATE documents SET
                reader_mode = ?,
                code_url = ?,
                has_code = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
        args: [effectiveReaderMode, effectiveCodeUrl || null, effectiveHasCode, parseInt(documentId)],
      });
    }

    // Mark as processing
    await db.execute({
      sql: "UPDATE documents SET processing_status = 'processing', processing_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [parseInt(documentId)],
    });

    // Record in history
    await db.execute({
      sql: "INSERT INTO processing_history (document_id, status, started_at) VALUES (?, 'processing', CURRENT_TIMESTAMP)",
      args: [parseInt(documentId)],
    });

    // Process the document
    try {
      const result = await readerService.processDocument(
        {
          documentId: parseInt(documentId),
          title: doc.title,
          s3Key: doc.s3_key,
          fileSize: doc.file_size,
          mimeType: doc.mime_type,
          readerMode: effectiveReaderMode,
          codeUrl: effectiveCodeUrl,
          hasCode: effectiveHasCode === 1,
        },
        { provider, promptTemplateId, readerMode: effectiveReaderMode }
      );

      // Mark as completed with extra data
      const extraData = {};
      if (result.codeNotesS3Key) {
        extraData.codeNotesS3Key = result.codeNotesS3Key;
      }
      if (result.hasCode !== undefined) {
        extraData.hasCode = result.hasCode;
      }

      await queueService.markCompleted(parseInt(documentId), result.notesS3Key, result.pageCount, extraData);

      res.json({
        success: true,
        documentId: parseInt(documentId),
        hasNotes: Boolean(result.notesS3Key),
        hasCodeNotes: Boolean(result.codeNotesS3Key),
        pageCount: result.pageCount,
        readerMode: effectiveReaderMode,
      });
    } catch (error) {
      // Mark as failed
      await queueService.markFailed(parseInt(documentId), error, false);

      res.status(500).json({
        error: 'Processing failed',
        message: error.message,
      });
    }
  } catch (error) {
    console.error('Error processing document:', error);
    res.status(500).json({ error: 'Failed to process document' });
  }
});

/**
 * POST /api/reader/reset-stuck
 * Reset all stuck queued/pending papers to idle (requires auth)
 */
router.post('/reset-stuck', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    // Reset queued and pending documents to idle
    const result = await db.execute(`
      UPDATE documents SET processing_status = 'idle', updated_at = CURRENT_TIMESTAMP
      WHERE processing_status IN ('queued', 'pending')
    `);

    // Clean up the processing queue
    await db.execute(`DELETE FROM processing_queue`);

    res.json({ success: true, resetCount: result.rowsAffected });
  } catch (error) {
    console.error('Error resetting stuck papers:', error);
    res.status(500).json({ error: 'Failed to reset stuck papers' });
  }
});

/**
 * GET /api/reader/templates
 * List all prompt templates
 */
router.get('/templates', async (req, res) => {
  try {
    const userId = req.query.userId || 'default_user';
    const templates = await readerService.listPromptTemplates(userId);
    res.json(templates);
  } catch (error) {
    console.error('Error listing templates:', error);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

/**
 * GET /api/reader/templates/:id
 * Get a specific prompt template
 */
router.get('/templates/:id', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const result = await db.execute({
      sql: 'SELECT * FROM prompt_templates WHERE id = ?',
      args: [parseInt(req.params.id)],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      name: row.name,
      description: row.description,
      systemPrompt: row.system_prompt,
      userPrompt: row.user_prompt,
      isDefault: row.is_default === 1,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  } catch (error) {
    console.error('Error getting template:', error);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

/**
 * POST /api/reader/templates
 * Create a new prompt template (requires auth)
 */
router.post('/templates', requireAuth, async (req, res) => {
  try {
    const { name, description, systemPrompt, userPrompt, isDefault, userId } = req.body;

    if (!name || !userPrompt) {
      return res.status(400).json({ error: 'Name and userPrompt are required' });
    }

    const template = await readerService.createPromptTemplate({
      name,
      description,
      systemPrompt,
      userPrompt,
      isDefault,
      userId,
    });

    res.status(201).json(template);
  } catch (error) {
    console.error('Error creating template:', error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

/**
 * PUT /api/reader/templates/:id
 * Update a prompt template (requires auth)
 */
router.put('/templates/:id', requireAuth, async (req, res) => {
  try {
    const { name, description, systemPrompt, userPrompt, isDefault } = req.body;

    const template = await readerService.updatePromptTemplate(parseInt(req.params.id), {
      name,
      description,
      systemPrompt,
      userPrompt,
      isDefault,
    });

    res.json(template);
  } catch (error) {
    console.error('Error updating template:', error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

/**
 * DELETE /api/reader/templates/:id
 * Delete a prompt template (requires auth)
 */
router.delete('/templates/:id', requireAuth, async (req, res) => {
  try {
    await readerService.deletePromptTemplate(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting template:', error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

/**
 * GET /api/reader/history
 * Get processing history
 */
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { getDb } = require('../db');
    const db = getDb();

    let sql = `
      SELECT ph.*, d.title as document_title
      FROM processing_history ph
      JOIN documents d ON ph.document_id = d.id
    `;
    const args = [];

    if (status) {
      sql += ' WHERE ph.status = ?';
      args.push(status);
    }

    sql += ' ORDER BY ph.started_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    const result = await db.execute({ sql, args });

    // Get total count
    let countSql = 'SELECT COUNT(*) as count FROM processing_history';
    if (status) {
      countSql += ' WHERE status = ?';
    }

    const countResult = await db.execute({
      sql: countSql,
      args: status ? [status] : [],
    });

    res.json({
      history: result.rows.map((row) => ({
        id: row.id,
        documentId: row.document_id,
        documentTitle: row.document_title,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
        modelUsed: row.model_used,
        errorMessage: row.error_message,
      })),
      total: countResult.rows[0].count,
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error getting history:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * POST /api/reader/skills/resolve
 * Resolve a skill from a URL (downloads SKILL.md) or a text description (LLM-generated).
 * Body: { input: string }
 */
router.post('/skills/resolve', requireAuth, async (req, res) => {
  try {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ error: 'input is required' });
    }

    const trimmed = input.trim();
    const isUrl = /^https?:\/\//i.test(trimmed);

    if (isUrl) {
      // Convert GitHub blob URL to raw.githubusercontent.com URL
      let fetchUrl = trimmed;
      const ghMatch = trimmed.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
      if (ghMatch) {
        fetchUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}`;
      }

      const response = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const content = await response.text();
      if (!content.trim()) {
        return res.status(422).json({ error: 'Empty content at URL' });
      }

      // Extract name from YAML frontmatter (name: value)
      let name = 'Skill from URL';
      const fmMatch = content.match(/^---\s*\n[\s\S]*?\nname:\s*(.+)/m);
      if (fmMatch) name = fmMatch[1].trim();

      return res.json({ name, prompt: content, sourceUrl: trimmed, type: 'url' });
    }

    // Text description → generate skill prompt with LLM
    const claudeCodeService = require('../services/claude-code.service');
    const available = await claudeCodeService.isAvailable();
    if (!available) {
      // Fallback: use description verbatim
      return res.json({ name: 'Custom Skill', prompt: trimmed, type: 'created', sourceUrl: '' });
    }

    const creatorPrompt = `You are a skill builder for an AI paper reading system. A user wants to create a custom reading skill.

Write a complete, actionable prompt that will be sent directly to an LLM along with an academic PDF to produce the desired reading notes.

User's request: "${trimmed}"

Requirements:
- Be specific and detailed about what to analyze and how to structure the output
- Match the language/style implied by the user's request
- Output ONLY the prompt text itself with no preamble, meta-commentary, or explanation

Prompt:`;

    const result = await claudeCodeService.runClaudeHeadless(creatorPrompt, {
      model: 'claude-haiku-4-5-20251001',
      timeout: 60000,
    });
    const generatedPrompt = result.text.trim();

    // Generate a short name
    const nameResult = await claudeCodeService.runClaudeHeadless(
      `Give a short 2-5 word title (Title Case) for an AI reading skill that: "${trimmed}". Return ONLY the title, nothing else.`,
      { model: 'claude-haiku-4-5-20251001', timeout: 30000 },
    ).catch(() => ({ text: 'Custom Skill' }));
    const name = nameResult.text.trim().replace(/^["']|["']$/g, '') || 'Custom Skill';

    return res.json({ name, prompt: generatedPrompt, type: 'created', sourceUrl: '' });
  } catch (err) {
    console.error('[skills/resolve] error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to resolve skill' });
  }
});

module.exports = router;
