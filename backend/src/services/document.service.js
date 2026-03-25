const { getDb } = require('../db');
const s3Service = require('./s3.service');

const DOCUMENTS_QUERY_TIMEOUT_MS = parseInt(process.env.DOCUMENTS_QUERY_TIMEOUT_MS || '8000', 10);
const DOCUMENTS_QUERY_RETRIES = parseInt(process.env.DOCUMENTS_QUERY_RETRIES || '1', 10);

function createTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = 'ETIMEDOUT';
  return error;
}

async function executeWithTimeoutAndRetry(db, query, options = {}) {
  const {
    timeoutMs = DOCUMENTS_QUERY_TIMEOUT_MS,
    retries = DOCUMENTS_QUERY_RETRIES,
    label = 'db.query',
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let timeoutId;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(createTimeoutError(label, timeoutMs)), timeoutMs);
      });
      return await Promise.race([db.execute(query), timeoutPromise]);
    } catch (error) {
      lastError = error;
      const isTimeout = error.code === 'ETIMEDOUT';
      if (!isTimeout || attempt === retries) {
        throw error;
      }
      console.warn(`[DocumentService] ${label} timeout (attempt ${attempt + 1}/${retries + 1}), retrying...`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

/**
 * Convert database row to document object
 */
function rowToDocument(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    originalUrl: row.original_url,
    s3Key: row.s3_key,
    s3Url: row.s3_url,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    tags: JSON.parse(row.tags || '[]'),
    notes: row.notes,
    userId: row.user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Processing status fields
    processingStatus: row.processing_status || 'idle',
    notesS3Key: row.notes_s3_key,
    pageCount: row.page_count,
    processingError: row.processing_error,
    processingStartedAt: row.processing_started_at,
    processingCompletedAt: row.processing_completed_at,
    // Read status
    isRead: row.is_read === 1,
    // Auto-reader mode fields
    readerMode: row.reader_mode || 'auto_reader_v2',
    codeNotesS3Key: row.code_notes_s3_key,
    hasCode: row.has_code === 1,
    codeUrl: row.code_url,
    // Code analysis status
    codeAnalysisStatus: row.code_analysis_status,
    // Analysis provider (gemini-cli, google-api, claude-code)
    analysisProvider: row.analysis_provider || 'gemini-cli',
  };
}

/**
 * Create a new document
 * @param {Object} data - Document data
 * @returns {Promise<Object>}
 */
async function createDocument(data) {
  const db = getDb();
  const tags = JSON.stringify(data.tags || []);

  const result = await db.execute({
    sql: `INSERT INTO documents (title, type, original_url, s3_key, s3_url, file_size, mime_type, tags, notes, user_id, reader_mode, analysis_provider, processing_status, is_read, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'idle', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    args: [
      data.title,
      data.type || 'other',
      data.originalUrl || null,
      data.s3Key,
      data.s3Url || null,
      data.fileSize || null,
      data.mimeType || 'application/pdf',
      tags,
      data.notes || null,
      data.userId || 'default_user',
      data.readerMode || 'auto_reader_v2',  // Default to auto_reader_v2 mode
      data.analysisProvider || 'gemini-cli',  // Default to gemini-cli
    ],
  });

  const id = Number(result.lastInsertRowid);
  return getDocumentById(id);
}

/**
 * Get documents with filtering and pagination
 * @param {Object} filters - Filter options
 * @param {Object} pagination - Pagination options (supports page or offset)
 * @returns {Promise<{documents: Object[], total: number, page: number, totalPages: number}>}
 */
async function getDocuments(filters = {}, pagination = {}, sortOptions = {}, options = {}) {
  const db = getDb();
  const { userId = 'default_user', type, search, tags, readFilter } = filters;
  const { page = 1, limit = 20 } = pagination;
  const { includeTotal = false } = options;

  // Resolve sort column and direction
  const allowedSorts = { createdAt: 'created_at', title: 'title' };
  const sortCol = allowedSorts[sortOptions.sort] || 'created_at';
  const sortDir = sortOptions.order === 'asc' ? 'ASC' : 'DESC';

  // Support both page-based and offset-based pagination
  const rawOffset = pagination.offset !== undefined
    ? pagination.offset
    : (page - 1) * limit;
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const safeOffset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  let whereClauses = ['user_id = ?'];
  let args = [userId];

  if (type) {
    whereClauses.push('type = ?');
    args.push(type);
  }

  if (search) {
    whereClauses.push('(title LIKE ? OR notes LIKE ? OR tags LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (tags && tags.length > 0) {
    const tagConditions = tags.map(() => 'tags LIKE ?').join(' OR ');
    whereClauses.push(`(${tagConditions})`);
    tags.forEach(tag => args.push(`%"${tag}"%`));
  }

  if (readFilter === 'unread') {
    whereClauses.push('is_read = 0');
  } else if (readFilter === 'read') {
    whereClauses.push('is_read = 1');
  }

  const whereClause = whereClauses.join(' AND ');

  // Query one extra row so callers can determine if more data exists without
  // always forcing a costly COUNT(*).
  const result = await executeWithTimeoutAndRetry(db, {
    sql: `SELECT id, title, type, original_url, tags, user_id, created_at, updated_at, processing_status, is_read, reader_mode, has_code, code_url, code_analysis_status, analysis_provider
          FROM documents
          WHERE ${whereClause}
          ORDER BY ${sortCol} ${sortDir}
          LIMIT ? OFFSET ?`,
    args: [...args, safeLimit + 1, safeOffset],
  }, { label: 'documents.list' });

  const hasMore = result.rows.length > safeLimit;
  const rows = hasMore ? result.rows.slice(0, safeLimit) : result.rows;
  const documents = rows.map(rowToDocument);

  // Return an estimate by default; optionally compute exact total when requested.
  let total = safeOffset + documents.length + (hasMore ? 1 : 0);
  let totalExact = false;
  if (includeTotal) {
    try {
      const countResult = await executeWithTimeoutAndRetry(db, {
        sql: `SELECT COUNT(*) as count FROM documents WHERE ${whereClause}`,
        args,
      }, {
        timeoutMs: Math.min(DOCUMENTS_QUERY_TIMEOUT_MS, 4000),
        retries: 0,
        label: 'documents.count',
      });
      total = Number(countResult.rows[0].count);
      totalExact = true;
    } catch (error) {
      console.warn(`[DocumentService] documents.count failed, using estimated total: ${error.message}`);
    }
  }

  return {
    documents,
    total,
    totalExact,
    hasMore,
    page,
    totalPages: Math.ceil(total / safeLimit),
  };
}

/**
 * Get a single document by ID
 * @param {number} id - Document ID
 * @returns {Promise<Object|null>}
 */
async function getDocumentById(id) {
  const db = getDb();
  // Coerce ID to number — MongoDB stores auto-increment IDs as integers
  const numericId = typeof id === 'string' ? parseInt(id, 10) : id;
  const result = await db.execute({
    sql: 'SELECT * FROM documents WHERE id = ?',
    args: [Number.isNaN(numericId) ? id : numericId],
  });

  return rowToDocument(result.rows[0]);
}

/**
 * Update a document
 * @param {number} id - Document ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object|null>}
 */
async function updateDocument(id, data) {
  const db = getDb();
  const allowedUpdates = ['title', 'type', 'tags', 'notes', 'reader_mode', 'code_url', 'has_code', 'analysis_provider'];
  const updates = [];
  const args = [];

  // Map camelCase to snake_case for DB columns
  const fieldMapping = {
    readerMode: 'reader_mode',
    codeUrl: 'code_url',
    hasCode: 'has_code',
    analysisProvider: 'analysis_provider',
  };

  for (const key of Object.keys(data)) {
    const dbKey = fieldMapping[key] || key;
    if (allowedUpdates.includes(dbKey) && data[key] !== undefined) {
      updates.push(`${dbKey} = ?`);
      if (dbKey === 'tags') {
        args.push(JSON.stringify(data[key]));
      } else if (dbKey === 'has_code') {
        args.push(data[key] ? 1 : 0);
      } else {
        args.push(data[key]);
      }
    }
  }

  if (updates.length === 0) {
    return getDocumentById(id);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(id);

  await db.execute({
    sql: `UPDATE documents SET ${updates.join(', ')} WHERE id = ?`,
    args: args,
  });

  return getDocumentById(id);
}

/**
 * Delete a document and its S3 file
 * @param {number} id - Document ID
 * @returns {Promise<boolean>}
 */
async function deleteDocument(id) {
  const db = getDb();
  const document = await getDocumentById(id);

  if (!document) {
    return false;
  }

  // Delete from S3
  if (document.s3Key) {
    try {
      await s3Service.deleteObject(document.s3Key);
    } catch (error) {
      console.error('Failed to delete S3 object:', error);
    }
  }

  await db.execute({
    sql: 'DELETE FROM documents WHERE id = ?',
    args: [id],
  });

  return true;
}

/**
 * Get document with fresh presigned download URL
 * @param {number} id - Document ID
 * @returns {Promise<Object|null>}
 */
async function getDocumentWithDownloadUrl(id) {
  const document = await getDocumentById(id);

  if (!document || !document.s3Key) {
    return document;
  }

  const downloadUrl = await s3Service.generatePresignedDownloadUrl(document.s3Key);
  return { ...document, downloadUrl };
}

/**
 * Strip internal S3 keys from a document before sending to clients.
 * Replaces raw keys with boolean flags.
 */
function sanitizeForClient(doc) {
  if (!doc) return doc;
  const { notesS3Key, codeNotesS3Key, s3Key, ...rest } = doc;
  return {
    ...rest,
    hasNotes: !!notesS3Key,
    hasCodeNotes: !!codeNotesS3Key,
  };
}

module.exports = {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument,
  getDocumentWithDownloadUrl,
  sanitizeForClient,
};
