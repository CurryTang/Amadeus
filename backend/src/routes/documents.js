const express = require('express');
const router = express.Router();
const documentService = require('../services/document.service');
const { sanitizeForClient } = documentService;
const researchPackService = require('../services/research-pack.service');
const {
  buildSshTransportCommand,
  exec: execSsh,
} = require('../services/ssh-transport.service');
const { requireAuth } = require('../middleware/auth');

// GET /api/documents - List all documents with pagination
router.get('/', async (req, res) => {
  try {
    const { page, limit = 20, offset, type, search, tags, sort, order, readFilter } = req.query;

    const filters = {
      userId: req.userId || 'czk',
      type,
      search,
      tags: tags ? tags.split(',') : undefined,
      readFilter,
    };

    // Support both page-based and offset-based pagination
    const limitValue = parseInt(limit, 10);
    const parsedLimit = Number.isFinite(limitValue) && limitValue > 0
      ? Math.min(limitValue, 100)
      : 20;
    let pagination;

    if (offset !== undefined) {
      const offsetValue = parseInt(offset, 10);
      // Offset-based pagination
      pagination = {
        offset: Number.isFinite(offsetValue) && offsetValue >= 0 ? offsetValue : 0,
        limit: parsedLimit,
      };
    } else {
      const pageValue = parseInt(page, 10);
      // Page-based pagination (default)
      pagination = {
        page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
        limit: parsedLimit,
      };
    }

    const sortOptions = { sort, order };
    const options = { includeTotal: req.query.includeTotal === 'true' };

    const result = await documentService.getDocuments(filters, pagination, sortOptions, options);
    res.json({
      ...result,
      documents: result.documents.map(sanitizeForClient),
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    if (error.code === 'ETIMEDOUT') {
      return res.status(504).json({ error: 'Documents query timed out. Please retry.' });
    }
    res.status(500).json({ error: 'Failed to fetch documents' });
  }
});

// GET /api/documents/:id - Get single document
router.get('/:id', async (req, res) => {
  try {
    const document = await documentService.getDocumentWithDownloadUrl(req.params.id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(sanitizeForClient(document));
  } catch (error) {
    console.error('Error fetching document:', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// GET /api/documents/:id/download - Get download URL for a document
router.get('/:id/download', async (req, res) => {
  try {
    const document = await documentService.getDocumentWithDownloadUrl(req.params.id);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!document.downloadUrl) {
      return res.status(404).json({ error: 'No file available for download' });
    }

    res.json({ downloadUrl: document.downloadUrl });
  } catch (error) {
    console.error('Error getting download URL:', error);
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

// POST /api/documents/research-pack - Download batch research pack as ZIP (requires auth)
// Accepts { documentIds: number[], sourceType: 'pdf'|'latex', includeCode: boolean, useMathpix: boolean }
router.post('/research-pack', requireAuth, async (req, res) => {
  try {
    const { documentIds, sourceType = 'pdf', includeCode = true, useMathpix = false } = req.body;

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'documentIds array is required' });
    }

    if (documentIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 documents per pack' });
    }

    if (!['pdf', 'latex'].includes(sourceType)) {
      return res.status(400).json({ error: 'sourceType must be "pdf" or "latex"' });
    }

    // Fetch all documents
    const documents = [];
    for (const id of documentIds) {
      const doc = await documentService.getDocumentById(id);
      if (doc) documents.push(doc);
    }

    if (documents.length === 0) {
      return res.status(404).json({ error: 'No valid documents found' });
    }

    console.log(`[ResearchPack] Creating batch pack for ${documents.length} documents (source: ${sourceType}, code: ${includeCode}, mathpix: ${useMathpix})`);

    const { archive } = await researchPackService.createBatchResearchPack(documents, {
      sourceType,
      includeCode,
      useMathpix,
    });

    const filename = `research_pack_${documents.length}_papers.zip`;
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    archive.pipe(res);

    archive.on('error', (err) => {
      console.error('[ResearchPack] Archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create research pack' });
      }
    });
  } catch (error) {
    console.error('Error creating research pack:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to create research pack' });
    }
  }
});

// POST /api/documents/research-pack/rsync - Send batch research pack to remote server via rsync (requires auth)
// Accepts { documentIds, sourceType, includeCode, useMathpix, serverId, remotePath }
router.post('/research-pack/rsync', requireAuth, async (req, res) => {
  const { spawn } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const config = require('../config');
  const { getDb } = require('../db');

  try {
    const { documentIds, sourceType = 'pdf', includeCode = true, useMathpix = false, serverId, remotePath, symlinkName } = req.body;

    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      return res.status(400).json({ error: 'documentIds array is required' });
    }
    if (documentIds.length > 50) {
      return res.status(400).json({ error: 'Maximum 50 documents per pack' });
    }
    if (!serverId) return res.status(400).json({ error: 'serverId is required' });
    if (!remotePath) return res.status(400).json({ error: 'remotePath is required' });

    // Fetch server config
    const db = getDb();
    const serverResult = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [serverId] });
    if (!serverResult.rows.length) return res.status(404).json({ error: 'SSH server not found' });
    const server = serverResult.rows[0];

    // Fetch documents
    const documents = [];
    for (const id of documentIds) {
      const doc = await documentService.getDocumentById(id);
      if (doc) documents.push(doc);
    }
    if (documents.length === 0) return res.status(404).json({ error: 'No valid documents found' });

    console.log(`[ResearchPack/rsync] Packing ${documents.length} docs for ${server.user}@${server.host}:${remotePath}`);

    // Build the archive to a temp file
    const tmpDir = config.reader.tmpDir;
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpFile = path.join(tmpDir, `rsync_pack_${Date.now()}.zip`);

    const { archive } = await researchPackService.createBatchResearchPack(documents, {
      sourceType,
      includeCode,
      useMathpix,
    });

    // Pipe archive to temp file
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmpFile);
      archive.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      archive.on('error', reject);
    });

    console.log(`[ResearchPack/rsync] Archive written (${(fs.statSync(tmpFile).size / 1024 / 1024).toFixed(1)} MB), starting rsync...`);

    const sshOpts = buildSshTransportCommand(server, { connectTimeout: 30 });
    const dest = `${server.user}@${server.host}:${remotePath}/`;

    await new Promise((resolve, reject) => {
      const proc = spawn('rsync', ['-avz', '--progress', '-e', sshOpts, tmpFile, dest]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`rsync exited with code ${code}: ${stderr.trim()}`));
      });
      proc.on('error', (err) => reject(new Error(`Failed to start rsync: ${err.message}`)));
    });

    // Clean up temp file
    try { fs.unlinkSync(tmpFile); } catch (_) {}

    // Optionally create a symlink on the remote server
    const symlinkMsg = [];
    if (symlinkName && symlinkName.trim()) {
      const sentFilename = path.basename(tmpFile);
      const linkName = symlinkName.trim();
      await execSsh(
        server,
        ['ln', '-sfn', `${remotePath}/${sentFilename}`, `${remotePath}/${linkName}`],
        { timeoutMs: 15000, stdio: ['ignore', 'pipe', 'pipe'] }
      ).catch((error) => {
        throw new Error(`symlink failed: ${error?.stderr?.trim() || error.message || 'ssh error'}`);
      });
      symlinkMsg.push(`symlink '${linkName}' created`);
      console.log(`[ResearchPack/rsync] Symlink '${linkName}' → '${sentFilename}' on ${server.host}`);
    }

    console.log(`[ResearchPack/rsync] Done — sent to ${server.user}@${server.host}:${remotePath}`);
    res.json({
      success: true,
      message: `Sent ${documents.length} paper(s) to ${server.user}@${server.host}:${remotePath}${symlinkMsg.length ? ` (${symlinkMsg.join(', ')})` : ''}`,
    });
  } catch (error) {
    console.error('[ResearchPack/rsync] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to send research pack' });
  }
});

// GET /api/documents/:id/notes - Get notes URL and content for a document
router.get('/:id/notes', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const s3Service = require('../services/s3.service');
    const db = getDb();
    const docId = parseInt(req.params.id, 10) || req.params.id;

    const result = await db.execute({
      sql: `SELECT id, title, notes_s3_key, code_notes_s3_key, processing_status,
                   reader_mode, has_code, code_url
            FROM documents WHERE id = ?`,
      args: [docId],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = result.rows[0];

    // Get reading history
    const history = await db.execute({
      sql: `SELECT id, reader_name, reader_mode, notes, read_at
            FROM reading_history
            WHERE document_id = ?
            ORDER BY read_at DESC`,
      args: [docId],
    });

    const readingHistory = history.rows.map(row => ({
      id: row.id,
      readerName: row.reader_name,
      readerMode: row.reader_mode,
      notes: row.notes,
      readAt: row.read_at,
    }));

    if (!doc.notes_s3_key) {
      // No processed notes yet
      return res.json({
        documentId: doc.id,
        title: doc.title,
        processingStatus: doc.processing_status,
        readerMode: doc.reader_mode || 'auto_reader',
        hasNotes: false,
        hasCodeNotes: false,
        hasCode: doc.has_code === 1,
        codeUrl: doc.code_url,
        notesUrl: null,
        notesContent: null,
        readingHistory,
      });
    }

    // Get presigned URL for notes
    const notesUrl = await s3Service.generatePresignedDownloadUrl(doc.notes_s3_key);

    // Optionally fetch and return content inline (useful for frontend rendering)
    let notesContent = null;
    if (req.query.inline === 'true') {
      try {
        const buffer = await s3Service.downloadBuffer(doc.notes_s3_key);
        notesContent = buffer.toString('utf-8');
      } catch (error) {
        console.error('Error fetching notes content:', error);
      }
    }

    // Get code notes URL if available
    let codeNotesUrl = null;
    let codeNotesContent = null;
    if (doc.code_notes_s3_key) {
      codeNotesUrl = await s3Service.generatePresignedDownloadUrl(doc.code_notes_s3_key);
      if (req.query.inline === 'true') {
        try {
          const buffer = await s3Service.downloadBuffer(doc.code_notes_s3_key);
          codeNotesContent = buffer.toString('utf-8');
        } catch (error) {
          console.error('Error fetching code notes content:', error);
        }
      }
    }

    res.json({
      documentId: doc.id,
      title: doc.title,
      processingStatus: doc.processing_status,
      readerMode: doc.reader_mode || 'auto_reader',
      hasNotes: true,
      hasCodeNotes: !!doc.code_notes_s3_key,
      hasCode: doc.has_code === 1,
      codeUrl: doc.code_url,
      notesUrl,
      notesContent,
      codeNotesUrl,
      codeNotesContent,
      readingHistory,
    });
  } catch (error) {
    console.error('Error getting notes:', error);
    res.status(500).json({ error: 'Failed to get notes' });
  }
});

// GET /api/documents/:id/processing-status - Get detailed processing status
router.get('/:id/processing-status', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT id, title, processing_status, page_count, processing_error,
                   processing_started_at, processing_completed_at
            FROM documents WHERE id = ?`,
      args: [req.params.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = result.rows[0];

    // Get queue info if queued
    let queueInfo = null;
    if (doc.processing_status === 'queued') {
      const queueResult = await db.execute({
        sql: 'SELECT priority, retry_count, max_retries, scheduled_at FROM processing_queue WHERE document_id = ?',
        args: [req.params.id],
      });

      if (queueResult.rows.length > 0) {
        const q = queueResult.rows[0];
        queueInfo = {
          priority: q.priority,
          retryCount: q.retry_count,
          maxRetries: q.max_retries,
          scheduledAt: q.scheduled_at,
        };
      }
    }

    res.json({
      documentId: doc.id,
      title: doc.title,
      status: doc.processing_status,
      pageCount: doc.page_count,
      error: doc.processing_error,
      startedAt: doc.processing_started_at,
      completedAt: doc.processing_completed_at,
      queueInfo,
    });
  } catch (error) {
    console.error('Error getting processing status:', error);
    res.status(500).json({ error: 'Failed to get processing status' });
  }
});

// POST /api/documents - Create new document (requires auth)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, type, originalUrl, s3Key, s3Url, fileSize, mimeType, tags, notes, readerMode } =
      req.body;

    if (!title || !s3Key) {
      return res.status(400).json({ error: 'Title and s3Key are required' });
    }

    const document = await documentService.createDocument({
      title,
      type: type || 'other',
      originalUrl,
      s3Key,
      s3Url,
      fileSize,
      mimeType,
      tags: tags || [],
      notes,
      userId: req.userId || 'czk',
      readerMode: readerMode || 'auto_reader',  // Default to auto_reader mode
    });

    res.status(201).json(sanitizeForClient(document));
  } catch (error) {
    console.error('Error creating document:', error);
    res.status(500).json({ error: 'Failed to create document' });
  }
});

// PUT /api/documents/:id - Update document (requires auth)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const document = await documentService.updateDocument(req.params.id, req.body);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(sanitizeForClient(document));
  } catch (error) {
    console.error('Error updating document:', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

// DELETE /api/documents/:id - Delete document (requires auth)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const deleted = await documentService.deleteDocument(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Error deleting document:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// POST /api/documents/:id/detect-code - Detect code URL for existing document (requires auth)
router.post('/:id/detect-code', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const arxivService = require('../services/arxiv.service');
    const db = getDb();

    // Get document
    const result = await db.execute({
      sql: 'SELECT id, title, original_url, notes FROM documents WHERE id = ?',
      args: [req.params.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = result.rows[0];

    // Parse arXiv ID from URL
    const arxivId = doc.original_url ? arxivService.parseArxivUrl(doc.original_url) : null;

    if (!arxivId) {
      return res.status(400).json({ error: 'Not an arXiv document' });
    }

    // Find code URL
    console.log(`Detecting code URL for document ${doc.id} (${arxivId})...`);
    const codeUrl = await arxivService.findCodeUrl(arxivId, doc.notes || '');

    if (codeUrl) {
      // Update document with code URL
      await db.execute({
        sql: 'UPDATE documents SET code_url = ?, has_code = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        args: [codeUrl, req.params.id],
      });

      res.json({
        id: parseInt(req.params.id),
        codeUrl,
        hasCode: true,
        message: 'Code URL detected successfully',
      });
    } else {
      res.json({
        id: parseInt(req.params.id),
        codeUrl: null,
        hasCode: false,
        message: 'No code repository found',
      });
    }
  } catch (error) {
    console.error('Error detecting code URL:', error);
    res.status(500).json({ error: 'Failed to detect code URL' });
  }
});

// PATCH /api/documents/:id/read - Toggle read status (requires auth)
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    // Get current read status
    const current = await db.execute({
      sql: 'SELECT id, is_read FROM documents WHERE id = ?',
      args: [req.params.id],
    });

    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Toggle read status (or set to specific value if provided)
    const currentIsRead = current.rows[0].is_read || 0;
    const newIsRead = req.body.isRead !== undefined ? (req.body.isRead ? 1 : 0) : (currentIsRead ? 0 : 1);

    await db.execute({
      sql: 'UPDATE documents SET is_read = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [newIsRead, req.params.id],
    });

    res.json({
      id: parseInt(req.params.id),
      isRead: newIsRead === 1,
    });
  } catch (error) {
    console.error('Error toggling read status:', error);
    res.status(500).json({ error: 'Failed to update read status' });
  }
});

// POST /api/documents/:id/reading-history - Record a read with name and date (requires auth)
router.post('/:id/reading-history', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const { readerName, readerMode, notes } = req.body;

    if (!readerName) {
      return res.status(400).json({ error: 'Reader name is required' });
    }

    // Check if document exists
    const doc = await db.execute({
      sql: 'SELECT id FROM documents WHERE id = ?',
      args: [req.params.id],
    });

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Insert reading history record
    const result = await db.execute({
      sql: `INSERT INTO reading_history (document_id, reader_name, reader_mode, notes)
            VALUES (?, ?, ?, ?)`,
      args: [req.params.id, readerName, readerMode || null, notes || null],
    });

    // Also mark document as read
    await db.execute({
      sql: 'UPDATE documents SET is_read = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      args: [req.params.id],
    });

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      documentId: parseInt(req.params.id),
      readerName,
      readerMode,
      notes,
      readAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error recording reading history:', error);
    res.status(500).json({ error: 'Failed to record reading history' });
  }
});

// GET /api/documents/:id/reading-history - Get reading history for a document
router.get('/:id/reading-history', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    // Check if document exists
    const doc = await db.execute({
      sql: 'SELECT id, title FROM documents WHERE id = ?',
      args: [req.params.id],
    });

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Get reading history
    const history = await db.execute({
      sql: `SELECT id, reader_name, reader_mode, notes, read_at
            FROM reading_history
            WHERE document_id = ?
            ORDER BY read_at DESC`,
      args: [req.params.id],
    });

    res.json({
      documentId: parseInt(req.params.id),
      title: doc.rows[0].title,
      history: history.rows.map(row => ({
        id: row.id,
        readerName: row.reader_name,
        readerMode: row.reader_mode,
        notes: row.notes,
        readAt: row.read_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching reading history:', error);
    res.status(500).json({ error: 'Failed to fetch reading history' });
  }
});

// PUT /api/documents/:id/notes/content - Update LLM-generated analysis content (requires auth)
router.put('/:id/notes/content', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const s3Service = require('../services/s3.service');
    const db = getDb();
    const { type, content } = req.body;

    if (!type || content === undefined) {
      return res.status(400).json({ error: 'type and content are required' });
    }

    const s3KeyField = type === 'paper' ? 'notes_s3_key' : 'code_notes_s3_key';

    const result = await db.execute({
      sql: `SELECT id, ${s3KeyField} as s3_key FROM documents WHERE id = ?`,
      args: [req.params.id],
    });

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const s3Key = result.rows[0].s3_key;
    if (!s3Key) {
      return res.status(404).json({ error: 'No notes found to update' });
    }

    await s3Service.uploadBuffer(Buffer.from(content, 'utf-8'), s3Key, 'text/markdown');

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating notes content:', error);
    res.status(500).json({ error: 'Failed to update notes content' });
  }
});

// POST /api/documents/:id/notes/ai-edit - Submit AI edit request (requires auth)
router.post('/:id/notes/ai-edit', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    const { type, prompt } = req.body;

    if (!type || !prompt) {
      return res.status(400).json({ error: 'type and prompt are required' });
    }

    // Check document exists and has notes
    const s3KeyField = type === 'paper' ? 'notes_s3_key' : 'code_notes_s3_key';
    const doc = await db.execute({
      sql: `SELECT id, ${s3KeyField} as s3_key FROM documents WHERE id = ?`,
      args: [req.params.id],
    });

    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (!doc.rows[0].s3_key) {
      return res.status(400).json({ error: 'No notes available to edit' });
    }

    // Check if there's already an active AI edit for this document
    const existing = await db.execute({
      sql: `SELECT id FROM ai_edit_queue WHERE document_id = ? AND status IN ('queued', 'processing')`,
      args: [req.params.id],
    });

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An AI edit is already in progress for this document' });
    }

    // Insert into AI edit queue
    const result = await db.execute({
      sql: `INSERT INTO ai_edit_queue (document_id, type, prompt) VALUES (?, ?, ?)`,
      args: [req.params.id, type, prompt],
    });

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      documentId: parseInt(req.params.id),
      type,
      status: 'queued',
    });
  } catch (error) {
    console.error('Error submitting AI edit:', error);
    res.status(500).json({ error: 'Failed to submit AI edit' });
  }
});

// GET /api/documents/:id/notes/ai-edit/status - Get AI edit status
router.get('/:id/notes/ai-edit/status', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT id, type, status, error_message, created_at, started_at, completed_at
            FROM ai_edit_queue
            WHERE document_id = ?
            ORDER BY created_at DESC
            LIMIT 1`,
      args: [req.params.id],
    });

    if (result.rows.length === 0) {
      return res.json({ status: 'idle' });
    }

    const job = result.rows[0];
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      error: job.error_message,
      createdAt: job.created_at,
      startedAt: job.started_at,
      completedAt: job.completed_at,
    });
  } catch (error) {
    console.error('Error getting AI edit status:', error);
    res.status(500).json({ error: 'Failed to get AI edit status' });
  }
});

// GET /api/documents/:id/user-notes - List user notes for a document
router.get('/:id/user-notes', async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT id, document_id, title, content, created_at, updated_at
            FROM user_notes WHERE document_id = ? ORDER BY updated_at DESC`,
      args: [req.params.id],
    });

    res.json({
      documentId: parseInt(req.params.id),
      notes: result.rows.map(row => ({
        id: row.id,
        documentId: row.document_id,
        title: row.title,
        content: row.content,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching user notes:', error);
    res.status(500).json({ error: 'Failed to fetch user notes' });
  }
});

// POST /api/documents/:id/user-notes - Create a user note (requires auth)
router.post('/:id/user-notes', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    const { title, content } = req.body;

    const doc = await db.execute({
      sql: 'SELECT id FROM documents WHERE id = ?',
      args: [req.params.id],
    });
    if (doc.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const result = await db.execute({
      sql: `INSERT INTO user_notes (document_id, title, content) VALUES (?, ?, ?)`,
      args: [req.params.id, title || '', content || ''],
    });

    res.status(201).json({
      id: Number(result.lastInsertRowid),
      documentId: parseInt(req.params.id),
      title: title || '',
      content: content || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error creating user note:', error);
    res.status(500).json({ error: 'Failed to create user note' });
  }
});

// PUT /api/documents/:id/user-notes/:noteId - Update a user note (requires auth)
router.put('/:id/user-notes/:noteId', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();
    const { title, content } = req.body;

    const existing = await db.execute({
      sql: 'SELECT id FROM user_notes WHERE id = ? AND document_id = ?',
      args: [req.params.noteId, req.params.id],
    });
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await db.execute({
      sql: `UPDATE user_notes SET title = ?, content = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND document_id = ?`,
      args: [title || '', content || '', req.params.noteId, req.params.id],
    });

    res.json({
      id: parseInt(req.params.noteId),
      documentId: parseInt(req.params.id),
      title: title || '',
      content: content || '',
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error updating user note:', error);
    res.status(500).json({ error: 'Failed to update user note' });
  }
});

// DELETE /api/documents/:id/user-notes/:noteId - Delete a user note (requires auth)
router.delete('/:id/user-notes/:noteId', requireAuth, async (req, res) => {
  try {
    const { getDb } = require('../db');
    const db = getDb();

    const existing = await db.execute({
      sql: 'SELECT id FROM user_notes WHERE id = ? AND document_id = ?',
      args: [req.params.noteId, req.params.id],
    });
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await db.execute({
      sql: 'DELETE FROM user_notes WHERE id = ? AND document_id = ?',
      args: [req.params.noteId, req.params.id],
    });

    res.json({ message: 'Note deleted successfully' });
  } catch (error) {
    console.error('Error deleting user note:', error);
    res.status(500).json({ error: 'Failed to delete user note' });
  }
});

module.exports = router;
