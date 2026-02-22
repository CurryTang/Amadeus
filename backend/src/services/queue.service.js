const { getDb } = require('../db');
const config = require('../config');

class QueueService {
  constructor() {
    this.isProcessing = false;
  }

  // Add a document to the processing queue
  async enqueueDocument(documentId, priority = 0) {
    const db = getDb();

    // Check if document exists and is in a valid state
    const doc = await db.execute({
      sql: 'SELECT id, processing_status FROM documents WHERE id = ?',
      args: [documentId],
    });

    if (doc.rows.length === 0) {
      throw new Error(`Document ${documentId} not found`);
    }

    const status = doc.rows[0].processing_status;
    if (status === 'processing') {
      throw new Error(`Document ${documentId} is currently being processed`);
    }

    // Add to queue (or update if already queued)
    try {
      await db.execute({
        sql: `INSERT INTO processing_queue (document_id, priority, scheduled_at)
              VALUES (?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(document_id) DO UPDATE SET
                priority = excluded.priority,
                scheduled_at = CURRENT_TIMESTAMP`,
        args: [documentId, priority],
      });

      // Update document status to queued
      await db.execute({
        sql: "UPDATE documents SET processing_status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        args: [documentId],
      });

      return { success: true, documentId, status: 'queued' };
    } catch (error) {
      console.error('Error enqueueing document:', error);
      throw error;
    }
  }

  // Get the next document to process (respecting rate limits)
  async dequeueNext() {
    const db = getDb();

    // Check rate limit first
    if (!(await this.canProcessMore())) {
      return null;
    }

    // Get the highest priority, oldest document from queue (respecting scheduled_at for retries)
    const result = await db.execute(`
      SELECT pq.id, pq.document_id, pq.retry_count, pq.max_retries,
             d.title, d.s3_key, d.file_size, d.mime_type,
             d.reader_mode, d.code_url, d.has_code, d.analysis_provider
      FROM processing_queue pq
      JOIN documents d ON pq.document_id = d.id
      WHERE d.processing_status = 'queued'
        AND pq.scheduled_at <= CURRENT_TIMESTAMP
      ORDER BY pq.priority DESC, pq.scheduled_at ASC
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      return null;
    }

    const item = result.rows[0];

    // Mark as processing
    await db.execute({
      sql: "UPDATE documents SET processing_status = 'processing', processing_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      args: [item.document_id],
    });

    // Record in processing history
    await db.execute({
      sql: `INSERT INTO processing_history (document_id, status, started_at)
            VALUES (?, 'processing', CURRENT_TIMESTAMP)`,
      args: [item.document_id],
    });

    return {
      queueId: item.id,
      documentId: item.document_id,
      title: item.title,
      s3Key: item.s3_key,
      fileSize: item.file_size,
      mimeType: item.mime_type,
      retryCount: item.retry_count,
      maxRetries: item.max_retries,
      readerMode: item.reader_mode || 'vanilla',
      codeUrl: item.code_url,
      hasCode: item.has_code === 1,
      analysisProvider: item.analysis_provider || 'gemini-cli',
    };
  }

  // Mark a document as completed
  async markCompleted(documentId, notesS3Key, pageCount = null, extraData = {}) {
    const db = getDb();

    // Build dynamic update for extra fields
    let extraSets = '';
    const args = [notesS3Key, pageCount];

    if (extraData.codeNotesS3Key) {
      extraSets += ', code_notes_s3_key = ?';
      args.push(extraData.codeNotesS3Key);
    }

    if (extraData.hasCode !== undefined) {
      extraSets += ', has_code = ?';
      args.push(extraData.hasCode ? 1 : 0);
    }

    if (extraData.codeUrl) {
      extraSets += ', code_url = ?';
      args.push(extraData.codeUrl);
    }

    args.push(documentId);

    // Update document
    await db.execute({
      sql: `UPDATE documents SET
              processing_status = 'completed',
              notes_s3_key = ?,
              page_count = ?${extraSets},
              processing_completed_at = CURRENT_TIMESTAMP,
              processing_error = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args,
    });

    // Remove from queue
    await db.execute({
      sql: 'DELETE FROM processing_queue WHERE document_id = ?',
      args: [documentId],
    });

    // Update processing history
    await db.execute({
      sql: `UPDATE processing_history
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
                duration_ms = (strftime('%s', 'now') - strftime('%s', started_at)) * 1000
            WHERE document_id = ? AND completed_at IS NULL`,
      args: [documentId],
    });
  }

  // Mark a document as failed
  async markFailed(documentId, error, shouldRetry = true) {
    const db = getDb();

    // Get current retry info
    const queueItem = await db.execute({
      sql: 'SELECT retry_count, max_retries FROM processing_queue WHERE document_id = ?',
      args: [documentId],
    });

    let newStatus = 'failed';
    let retryCount = 0;
    let maxRetries = 3;

    if (queueItem.rows.length > 0) {
      retryCount = queueItem.rows[0].retry_count;
      maxRetries = queueItem.rows[0].max_retries;
    }

    // Check if we should retry
    if (shouldRetry && retryCount < maxRetries) {
      newStatus = 'queued';
      retryCount++;

      // Update retry count and reschedule
      await db.execute({
        sql: `UPDATE processing_queue
              SET retry_count = ?, scheduled_at = datetime('now', '+' || (? * 5) || ' minutes')
              WHERE document_id = ?`,
        args: [retryCount, retryCount, documentId],
      });
    } else {
      // Remove from queue
      await db.execute({
        sql: 'DELETE FROM processing_queue WHERE document_id = ?',
        args: [documentId],
      });
    }

    // Update document
    await db.execute({
      sql: `UPDATE documents SET
              processing_status = ?,
              processing_error = ?,
              processing_completed_at = CURRENT_TIMESTAMP,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
      args: [newStatus, error.toString().substring(0, 500), documentId],
    });

    // Update processing history
    await db.execute({
      sql: `UPDATE processing_history
            SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = ?,
                duration_ms = (strftime('%s', 'now') - strftime('%s', started_at)) * 1000
            WHERE document_id = ? AND completed_at IS NULL`,
      args: [error.toString().substring(0, 500), documentId],
    });

    return { retried: newStatus === 'queued', retryCount };
  }

  // Check if we can process more documents (rate limiting)
  async canProcessMore() {
    const db = getDb();
    const maxPerHour = config.reader?.maxPerHour || 5;

    const result = await db.execute({
      sql: `SELECT COUNT(*) as count FROM processing_history
            WHERE started_at > datetime('now', '-1 hour')
            AND status IN ('completed', 'processing')`,
      args: [],
    });

    return result.rows[0].count < maxPerHour;
  }

  // Get queue status
  async getQueueStatus() {
    const db = getDb();
    const maxPerHour = config.reader?.maxPerHour || 5;

    // Queue length
    const queueLength = await db.execute(`
      SELECT COUNT(*) as count FROM processing_queue
    `);

    // Processed this hour
    const processedThisHour = await db.execute(`
      SELECT COUNT(*) as count FROM processing_history
      WHERE started_at > datetime('now', '-1 hour')
      AND status IN ('completed', 'processing')
    `);

    // Currently processing
    const currentlyProcessing = await db.execute(`
      SELECT COUNT(*) as count FROM documents WHERE processing_status = 'processing'
    `);

    // Failed documents
    const failedCount = await db.execute(`
      SELECT COUNT(*) as count FROM documents WHERE processing_status = 'failed'
    `);

    // Pending documents (not yet queued)
    const pendingCount = await db.execute(`
      SELECT COUNT(*) as count FROM documents
      WHERE processing_status = 'pending' AND mime_type = 'application/pdf'
    `);

    return {
      queueLength: queueLength.rows[0].count,
      processedThisHour: processedThisHour.rows[0].count,
      currentlyProcessing: currentlyProcessing.rows[0].count,
      failedCount: failedCount.rows[0].count,
      pendingCount: pendingCount.rows[0].count,
      rateLimit: maxPerHour,
      canProcess: processedThisHour.rows[0].count < maxPerHour,
    };
  }

  // Find documents that need to be queued
  async findPendingDocuments(limit = 10) {
    const db = getDb();

    const result = await db.execute({
      sql: `SELECT id, title, s3_key, file_size
            FROM documents
            WHERE processing_status = 'pending'
            AND mime_type = 'application/pdf'
            ORDER BY created_at ASC
            LIMIT ?`,
      args: [limit],
    });

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      s3Key: row.s3_key,
      fileSize: row.file_size,
    }));
  }

  // Cleanup stale processing jobs (stuck in processing for too long)
  async cleanupStaleJobs(maxAgeMinutes = 30) {
    const db = getDb();

    // Find documents stuck in processing
    const stale = await db.execute({
      sql: `SELECT id FROM documents
            WHERE processing_status = 'processing'
            AND processing_started_at < datetime('now', '-' || ? || ' minutes')`,
      args: [maxAgeMinutes],
    });

    for (const row of stale.rows) {
      await this.markFailed(row.id, new Error('Processing timeout - job stuck'), true);
    }

    return stale.rows.length;
  }
}

module.exports = new QueueService();
