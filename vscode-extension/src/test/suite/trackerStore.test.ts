import test from 'node:test';
import assert from 'node:assert/strict';

import { TrackerStore } from '../../tracker/store';
import { TrackedPapersProvider } from '../../views/trackedPapersProvider';

test('TrackerStore refreshes tracked papers, preserves selection, and exposes compact rows', async () => {
  const store = new TrackerStore({
    client: {
      async listTrackedPapers() {
        return {
          items: [
            {
              id: 'paper:2503.00001',
              itemType: 'paper',
              arxivId: '2503.00001',
              title: 'Test Paper',
              abstract: 'Summary',
              authors: ['Ada Lovelace'],
              publishedAt: '2026-03-13T12:00:00.000Z',
              trackedDate: '2026-03-14T12:00:00.000Z',
              sourceType: 'arxiv',
              sourceName: 'arXiv',
              sourceLabel: 'arXiv',
              saved: false,
              isRead: false,
            },
          ],
          total: 1,
          hasMore: false,
          offset: 0,
          limit: 20,
        };
      },
      async saveTrackedPaper() {
        throw new Error('not used');
      },
    },
  });

  await store.refresh();
  store.selectPaper('paper:2503.00001');

  const items = await new TrackedPapersProvider(store).getChildren();

  assert.equal(store.selectedPaperId, 'paper:2503.00001');
  assert.equal(store.selectedPaper?.title, 'Test Paper');
  assert.equal(items.length, 1);
  assert.equal(items[0].label, 'Test Paper');
  assert.equal(items[0].description, 'arXiv');
});
