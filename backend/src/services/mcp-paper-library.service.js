const { getDb } = require('../db');
const s3Service = require('./s3.service');
const citationService = require('./citation.service');

function normalizeTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags.filter(Boolean);
  if (typeof rawTags === 'string') {
    try {
      const parsed = JSON.parse(rawTags);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function mapDocumentRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    type: row.type || 'other',
    originalUrl: row.original_url || row.originalUrl || '',
    tags: normalizeTags(row.tags),
    notes: row.notes || '',
    notesS3Key: row.notes_s3_key || row.notesS3Key || '',
    codeNotesS3Key: row.code_notes_s3_key || row.codeNotesS3Key || '',
    createdAt: row.created_at || row.createdAt || '',
    updatedAt: row.updated_at || row.updatedAt || '',
  };
}

function mapTagRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    color: row.color,
  };
}

function mapUserNoteRow(row) {
  return {
    id: Number(row.id),
    title: row.title || '',
    content: row.content || '',
    createdAt: row.created_at || row.createdAt || '',
    updatedAt: row.updated_at || row.updatedAt || '',
  };
}

function mapReadingHistoryRow(row) {
  return {
    id: Number(row.id),
    readerName: row.reader_name || row.readerName || '',
    readerMode: row.reader_mode || row.readerMode || '',
    notes: row.notes || '',
    readAt: row.read_at || row.readAt || '',
  };
}

function extractYear(dateValue) {
  const match = String(dateValue || '').match(/\b(\d{4})\b/);
  return match ? match[1] : '';
}

async function defaultSearchDocuments({ query, userId, limit }) {
  const db = getDb();
  const filters = ['user_id = ?'];
  const args = [userId];

  if (query) {
    filters.push('(title LIKE ? OR original_url LIKE ? OR notes LIKE ? OR tags LIKE ?)');
    const like = `%${query}%`;
    args.push(like, like, like, like);
  }

  args.push(limit);
  const result = await db.execute({
    sql: `SELECT id, title, type, original_url, tags, notes, notes_s3_key, code_notes_s3_key, created_at, updated_at
          FROM documents
          WHERE ${filters.join(' AND ')}
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ?`,
    args,
  });

  return result.rows.map(mapDocumentRow);
}

async function defaultGetDocumentById({ id, userId }) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, title, type, original_url, tags, notes, notes_s3_key, code_notes_s3_key, created_at, updated_at
          FROM documents
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
    args: [id, userId],
  });
  return mapDocumentRow(result.rows[0]);
}

async function defaultListTags({ userId }) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, name, color FROM tags WHERE user_id = ? ORDER BY name ASC',
    args: [userId],
  });
  return result.rows.map(mapTagRow);
}

async function defaultListUserNotesByDocumentId({ documentId }) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, title, content, created_at, updated_at
          FROM user_notes
          WHERE document_id = ?
          ORDER BY updated_at DESC`,
    args: [documentId],
  });
  return result.rows.map(mapUserNoteRow);
}

async function defaultListReadingHistoryByDocumentId({ documentId }) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT id, reader_name, reader_mode, notes, read_at
          FROM reading_history
          WHERE document_id = ?
          ORDER BY read_at DESC`,
    args: [documentId],
  });
  return result.rows.map(mapReadingHistoryRow);
}

async function downloadTextIfPresent(storageKey) {
  if (!storageKey) return '';
  try {
    const buffer = await s3Service.downloadBuffer(storageKey);
    return buffer.toString('utf-8');
  } catch (error) {
    console.warn(`[McpPaperLibrary] Could not download ${storageKey}: ${error.message}`);
    return '';
  }
}

async function defaultGetProcessedNotesByDocumentId({ document }) {
  if (!document) return { paper: '', code: '' };
  const [paper, code] = await Promise.all([
    downloadTextIfPresent(document.notesS3Key),
    downloadTextIfPresent(document.codeNotesS3Key),
  ]);
  return { paper, code };
}

async function defaultGenerateCitationForDocument({ userId, document, format }) {
  return citationService.generateCitationForDocument({
    userId,
    document,
    formats: [format || 'bibtex'],
  });
}

function createMcpPaperLibraryService(overrides = {}) {
  const deps = {
    searchDocuments: overrides.searchDocuments || defaultSearchDocuments,
    getDocumentById: overrides.getDocumentById || defaultGetDocumentById,
    listTags: overrides.listTags || defaultListTags,
    listUserNotesByDocumentId: overrides.listUserNotesByDocumentId || defaultListUserNotesByDocumentId,
    listReadingHistoryByDocumentId: overrides.listReadingHistoryByDocumentId || defaultListReadingHistoryByDocumentId,
    getProcessedNotesByDocumentId: overrides.getProcessedNotesByDocumentId || defaultGetProcessedNotesByDocumentId,
    generateCitationForDocument: overrides.generateCitationForDocument || defaultGenerateCitationForDocument,
  };

  async function buildCitationSummary({ userId, document, format = 'bibtex' }) {
    try {
      const citation = await deps.generateCitationForDocument({ userId, document, format });
      return {
        authors: Array.isArray(citation?.metadata?.authors) ? citation.metadata.authors : [],
        date: citation?.metadata?.date || '',
        venue: citation?.metadata?.venue || '',
        bibtex: citation?.citations?.[format] || '',
      };
    } catch (error) {
      console.warn(`[McpPaperLibrary] Citation generation failed for document ${document?.id}: ${error.message}`);
      return {
        authors: [],
        date: '',
        venue: '',
        bibtex: '',
      };
    }
  }

  return {
    async searchLibrary({ query = '', userId = 'default_user', limit = 10 }) {
      const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 25)) : 10;
      const documents = await deps.searchDocuments({ query, userId, limit: safeLimit });
      const items = [];

      for (const document of documents) {
        const citation = await buildCitationSummary({ userId, document });
        items.push({
          id: `document:${document.id}`,
          documentId: document.id,
          title: document.title,
          type: document.type,
          authors: citation.authors,
          year: extractYear(citation.date),
          venue: citation.venue,
          tags: document.tags,
          sourceUrl: document.originalUrl,
        });
      }

      return {
        query,
        total: items.length,
        items,
      };
    },

    async getDocument({ id, userId = 'default_user' }) {
      const document = await deps.getDocumentById({ id, userId });
      if (!document) return null;

      const [processedNotes, userNotes, readingHistory, citation] = await Promise.all([
        deps.getProcessedNotesByDocumentId({ documentId: document.id, document, userId }),
        deps.listUserNotesByDocumentId({ documentId: document.id, userId }),
        deps.listReadingHistoryByDocumentId({ documentId: document.id, userId }),
        buildCitationSummary({ userId, document }),
      ]);

      return {
        id: `document:${document.id}`,
        documentId: document.id,
        title: document.title,
        type: document.type,
        tags: document.tags,
        sourceUrl: document.originalUrl,
        processedNotes,
        userNotes,
        readingHistory,
        citation,
      };
    },

    async listTags({ userId = 'default_user' }) {
      const tags = await deps.listTags({ userId });
      return { tags };
    },

    async getDocumentNotes({ id, userId = 'default_user' }) {
      const document = await deps.getDocumentById({ id, userId });
      if (!document) return null;
      const processedNotes = await deps.getProcessedNotesByDocumentId({ documentId: document.id, document, userId });
      return {
        id: `document:${document.id}`,
        documentId: document.id,
        processedNotes,
      };
    },

    async getUserNotes({ id, userId = 'default_user' }) {
      const document = await deps.getDocumentById({ id, userId });
      if (!document) return null;
      const notes = await deps.listUserNotesByDocumentId({ documentId: document.id, userId });
      return {
        id: `document:${document.id}`,
        documentId: document.id,
        notes,
      };
    },

    async getReadingHistory({ id, userId = 'default_user' }) {
      const document = await deps.getDocumentById({ id, userId });
      if (!document) return null;
      const history = await deps.listReadingHistoryByDocumentId({ documentId: document.id, userId });
      return {
        id: `document:${document.id}`,
        documentId: document.id,
        history,
      };
    },

    async exportCitation({ id, userId = 'default_user', format = 'bibtex' }) {
      const document = await deps.getDocumentById({ id, userId });
      if (!document) return null;
      const citation = await buildCitationSummary({ userId, document, format });
      return {
        id: `document:${document.id}`,
        documentId: document.id,
        format,
        citation: citation.bibtex,
        metadata: {
          authors: citation.authors,
          date: citation.date,
          venue: citation.venue,
        },
      };
    },
  };
}

module.exports = {
  createMcpPaperLibraryService,
};
