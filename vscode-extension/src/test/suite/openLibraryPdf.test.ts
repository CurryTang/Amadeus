import test from 'node:test';
import assert from 'node:assert/strict';

import { runOpenLibraryPdfCommand } from '../../commands/openLibraryPdf';

test('runOpenLibraryPdfCommand downloads the stored PDF and opens it in VS Code', async () => {
  const downloads: Array<{ url: string; title: string }> = [];
  const opened: string[] = [];

  const store = {
    selectedPaperId: 42,
    selectedPaperDetail: {
      id: 42,
      title: 'Saved Paper',
      type: 'paper',
      originalUrl: 'https://arxiv.org/abs/2503.00001',
      downloadUrl: 'https://signed.example.com/paper.pdf',
      tags: [],
      processingStatus: 'idle',
      read: false,
      createdAt: null,
      updatedAt: null,
      notesUrl: '',
      notesContent: '',
      readerMode: 'auto_reader_v2',
      hasCode: false,
      codeUrl: '',
      readingHistory: [],
    },
  };

  await runOpenLibraryPdfCommand({
    client: {
      async getLibraryPaperDetail() {
        throw new Error('should not refetch when detail is selected');
      },
    },
    store,
    downloadPdf: async (url, title) => {
      downloads.push({ url, title });
      return `/tmp/${title}.pdf`;
    },
    openPdf: async (path) => {
      opened.push(path);
    },
  });

  assert.deepEqual(downloads, [{ url: 'https://signed.example.com/paper.pdf', title: 'Saved Paper' }]);
  assert.deepEqual(opened, ['/tmp/Saved Paper.pdf']);
});

test('runOpenLibraryPdfCommand falls back to the original arXiv PDF when no stored download exists', async () => {
  const downloads: string[] = [];

  await runOpenLibraryPdfCommand({
    client: {
      async getLibraryPaperDetail() {
        return {
          id: 42,
          title: 'Saved Paper',
          type: 'paper',
          originalUrl: 'https://arxiv.org/abs/2503.00001',
          downloadUrl: '',
          tags: [],
          processingStatus: 'idle',
          read: false,
          createdAt: null,
          updatedAt: null,
          notesUrl: '',
          notesContent: '',
          readerMode: 'auto_reader_v2',
          hasCode: false,
          codeUrl: '',
          readingHistory: [],
        };
      },
    },
    store: {
      selectedPaperId: 42,
      selectedPaperDetail: null,
    },
    downloadPdf: async (url) => {
      downloads.push(url);
      return '/tmp/fallback.pdf';
    },
    openPdf: async () => undefined,
  });

  assert.deepEqual(downloads, ['https://arxiv.org/pdf/2503.00001.pdf']);
});

test('runOpenLibraryPdfCommand opens the original URL externally when it cannot derive a PDF URL', async () => {
  const external: string[] = [];

  await runOpenLibraryPdfCommand({
    client: {
      async getLibraryPaperDetail() {
        return {
          id: 42,
          title: 'Saved Paper',
          type: 'paper',
          originalUrl: 'https://openreview.net/forum?id=paper-123',
          downloadUrl: '',
          tags: [],
          processingStatus: 'idle',
          read: false,
          createdAt: null,
          updatedAt: null,
          notesUrl: '',
          notesContent: '',
          readerMode: 'auto_reader_v2',
          hasCode: false,
          codeUrl: '',
          readingHistory: [],
        };
      },
    },
    store: {
      selectedPaperId: 42,
      selectedPaperDetail: null,
    },
    downloadPdf: async () => {
      throw new Error('should not download a non-PDF original url');
    },
    openPdf: async () => {
      throw new Error('should not open pdf for non-PDF original url');
    },
    openExternalUrl: async (url) => {
      external.push(url);
    },
  });

  assert.deepEqual(external, ['https://openreview.net/forum?id=paper-123']);
});
