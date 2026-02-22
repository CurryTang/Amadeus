const express = require('express');
const router = express.Router();
const codeAnalysisService = require('../services/code-analysis.service');
const { requireAuth } = require('../middleware/auth');

/**
 * GET /api/code-analysis/status
 * Get code analysis queue status and rate limit info
 */
router.get('/status', async (req, res) => {
  try {
    const status = await codeAnalysisService.getQueueStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting code analysis status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /api/code-analysis/history
 * Get code analysis history
 * NOTE: This route MUST be before /:documentId to prevent being matched as a documentId
 */
router.get('/history', async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { getDb } = require('../db');
    const db = getDb();

    let sql = `
      SELECT cah.*, d.title as document_title, d.code_url
      FROM code_analysis_history cah
      JOIN documents d ON cah.document_id = d.id
    `;
    const args = [];

    if (status) {
      sql += ' WHERE cah.status = ?';
      args.push(status);
    }

    sql += ' ORDER BY cah.started_at DESC LIMIT ? OFFSET ?';
    args.push(parseInt(limit), offset);

    const result = await db.execute({ sql, args });

    // Get total count
    let countSql = 'SELECT COUNT(*) as count FROM code_analysis_history';
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
        codeUrl: row.code_url,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        durationMs: row.duration_ms,
        errorMessage: row.error_message,
      })),
      total: countResult.rows[0].count,
      page: parseInt(page),
      totalPages: Math.ceil(countResult.rows[0].count / parseInt(limit)),
    });
  } catch (error) {
    console.error('Error getting code analysis history:', error);
    res.status(500).json({ error: 'Failed to get history' });
  }
});

/**
 * GET /api/code-analysis/:documentId
 * Get code analysis status for a specific document
 */
router.get('/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;
    const status = await codeAnalysisService.getAnalysisStatus(parseInt(documentId));
    res.json(status);
  } catch (error) {
    console.error('Error getting document analysis status:', error);
    res.status(500).json({ error: 'Failed to get analysis status' });
  }
});

/**
 * POST /api/code-analysis/:documentId
 * Queue a document for code analysis (requires auth)
 */
router.post('/:documentId', requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const result = await codeAnalysisService.queueAnalysis(parseInt(documentId));

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (error) {
    console.error('Error queueing code analysis:', error);
    res.status(500).json({ error: 'Failed to queue analysis' });
  }
});

/**
 * DELETE /api/code-analysis/:documentId
 * Remove a document from the code analysis queue (requires auth)
 */
router.delete('/:documentId', requireAuth, async (req, res) => {
  try {
    const { documentId } = req.params;
    const { getDb } = require('../db');
    const db = getDb();

    // Only allow removing pending items
    const result = await db.execute({
      sql: `DELETE FROM code_analysis_queue WHERE document_id = ? AND status = 'pending'`,
      args: [parseInt(documentId)]
    });

    if (result.rowsAffected === 0) {
      return res.status(400).json({ error: 'Cannot remove: not in queue or already processing' });
    }

    // Update document status
    await db.execute({
      sql: `UPDATE documents SET code_analysis_status = NULL WHERE id = ?`,
      args: [parseInt(documentId)]
    });

    res.json({ success: true, documentId: parseInt(documentId) });
  } catch (error) {
    console.error('Error removing from code analysis queue:', error);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

module.exports = router;
