const test = require('node:test');
const assert = require('node:assert/strict');

const { createMcpPaperLibraryService } = require('../mcp-paper-library.service');

test('searchLibrary returns paper-centric search results', async () => {
  const service = createMcpPaperLibraryService({
    searchDocuments: async () => ([
      {
        id: 7,
        title: 'Diffusion Systems',
        type: 'paper',
        originalUrl: 'https://arxiv.org/abs/2501.00001',
        tags: ['diffusion', 'survey'],
        notes: 'authors: Ada Lovelace\npublished: 2025\nvenue: NeurIPS',
      },
    ]),
    generateCitationForDocument: async () => ({
      metadata: {
        authors: ['Ada Lovelace'],
        date: '2025',
        venue: 'NeurIPS',
      },
    }),
  });

  const result = await service.searchLibrary({ query: 'diffusion', userId: 'czk', limit: 5 });

  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    id: 'document:7',
    documentId: 7,
    title: 'Diffusion Systems',
    type: 'paper',
    authors: ['Ada Lovelace'],
    year: '2025',
    venue: 'NeurIPS',
    tags: ['diffusion', 'survey'],
    sourceUrl: 'https://arxiv.org/abs/2501.00001',
  });
});

test('getDocument aggregates processed notes, user notes, reading history, and citation data', async () => {
  const service = createMcpPaperLibraryService({
    getDocumentById: async () => ({
      id: 9,
      title: 'Retriever Notes',
      type: 'paper',
      originalUrl: 'https://example.com/paper.pdf',
      tags: ['retrieval'],
      notesS3Key: 'notes/9.md',
      codeNotesS3Key: 'code/9.md',
    }),
    getProcessedNotesByDocumentId: async () => ({
      paper: '# Summary\nImportant details',
      code: '# Code Notes\nImplementation details',
    }),
    listUserNotesByDocumentId: async () => ([
      {
        id: 3,
        title: 'Personal note',
        content: 'This matters',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z',
      },
    ]),
    listReadingHistoryByDocumentId: async () => ([
      {
        id: 5,
        readerName: 'czk',
        readerMode: 'auto_reader_v2',
        notes: 'Read carefully',
        readAt: '2026-03-03T00:00:00.000Z',
      },
    ]),
    generateCitationForDocument: async () => ({
      metadata: {
        authors: ['Grace Hopper'],
        date: '2024-12-01',
        venue: 'ICLR',
      },
      citations: {
        bibtex: '@article{retriever-notes}',
      },
    }),
  });

  const result = await service.getDocument({ id: 9, userId: 'czk' });

  assert.equal(result.id, 'document:9');
  assert.equal(result.documentId, 9);
  assert.equal(result.processedNotes.paper, '# Summary\nImportant details');
  assert.equal(result.processedNotes.code, '# Code Notes\nImplementation details');
  assert.deepEqual(result.userNotes.map((note) => note.title), ['Personal note']);
  assert.deepEqual(result.readingHistory.map((entry) => entry.readerName), ['czk']);
  assert.deepEqual(result.citation.authors, ['Grace Hopper']);
  assert.equal(result.citation.bibtex, '@article{retriever-notes}');
});

test('exportCitation returns a requested format for a document', async () => {
  const service = createMcpPaperLibraryService({
    getDocumentById: async () => ({
      id: 12,
      title: 'Paper',
      type: 'paper',
    }),
    generateCitationForDocument: async () => ({
      metadata: {
        authors: ['Claude Shannon'],
        date: '1948',
        venue: 'Bell System Technical Journal',
      },
      citations: {
        bibtex: '@article{shannon1948}',
      },
    }),
  });

  const result = await service.exportCitation({ id: 12, userId: 'czk', format: 'bibtex' });

  assert.deepEqual(result, {
    id: 'document:12',
    documentId: 12,
    format: 'bibtex',
    citation: '@article{shannon1948}',
    metadata: {
      authors: ['Claude Shannon'],
      date: '1948',
      venue: 'Bell System Technical Journal',
    },
  });
});
