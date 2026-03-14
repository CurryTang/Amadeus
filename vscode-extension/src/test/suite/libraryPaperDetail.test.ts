import test from 'node:test';
import assert from 'node:assert/strict';

import { renderLibraryPaperDetailHtml } from '../../webview/templates/libraryPaperDetailHtml';

test('renderLibraryPaperDetailHtml includes library metadata and library-only actions', () => {
  const html = renderLibraryPaperDetailHtml({
    id: 42,
    title: 'Saved Paper',
    type: 'paper',
    originalUrl: 'https://arxiv.org/abs/2503.00001',
    downloadUrl: 'https://signed.example.com/paper.pdf',
    tags: ['ml'],
    processingStatus: 'idle',
    read: false,
    createdAt: '2026-03-13T12:00:00.000Z',
    updatedAt: '2026-03-14T12:00:00.000Z',
    notesUrl: '',
    notesContent: 'Detailed notes',
    readerMode: 'auto_reader_v2',
    hasCode: false,
    codeUrl: '',
    readingHistory: [],
  });

  assert.match(html, /Saved Paper/);
  assert.match(html, /Detailed notes/);
  assert.match(html, /Mark Read/);
  assert.match(html, /Open PDF/);
  assert.match(html, /Queue Reader/);
});
