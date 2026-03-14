import test from 'node:test';
import assert from 'node:assert/strict';

import { LibraryStore } from '../../library/store';
import { LibraryProvider } from '../../views/libraryProvider';

test('LibraryStore refreshes library papers, loads selected detail, and exposes compact rows', async () => {
  const store = new LibraryStore({
    client: {
      async listLibraryPapers() {
        return [
          {
            id: 42,
            title: 'Saved Paper',
            type: 'paper',
            originalUrl: 'https://arxiv.org/abs/2503.00001',
            tags: [],
            processingStatus: 'idle',
            read: false,
            createdAt: '2026-03-13T12:00:00.000Z',
            updatedAt: '2026-03-14T12:00:00.000Z',
          },
        ];
      },
      async getLibraryPaperDetail() {
        return {
          id: 42,
          title: 'Saved Paper',
          type: 'paper',
          originalUrl: 'https://arxiv.org/abs/2503.00001',
          tags: [],
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
        };
      },
      async setReadState() {
        throw new Error('not used');
      },
      async queueReader() {
        throw new Error('not used');
      },
    },
  });

  await store.refresh();
  await store.selectPaper(42);

  const items = await new LibraryProvider(store).getChildren();

  assert.equal(store.selectedPaperId, 42);
  assert.equal(store.selectedPaperDetail?.notesContent, 'Detailed notes');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Saved Paper');
  assert.equal(items[0].description, 'unread · idle');
});
