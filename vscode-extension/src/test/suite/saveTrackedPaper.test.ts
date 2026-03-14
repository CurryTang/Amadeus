import test from 'node:test';
import assert from 'node:assert/strict';

import { runSaveTrackedPaperCommand } from '../../commands/saveTrackedPaper';
import type { TrackedPaperSummary } from '../../tracker/types';

test('runSaveTrackedPaperCommand saves the selected tracked paper and refreshes the tracker store', async () => {
  const saveCalls: string[] = [];
  let refreshCalls = 0;
  const paper: TrackedPaperSummary = {
    id: 'paper:2503.00001',
    itemType: 'paper' as const,
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
  };

  await runSaveTrackedPaperCommand({
    client: {
      async saveTrackedPaper(item: TrackedPaperSummary) {
        saveCalls.push(item.id);
        return {
          id: 42,
          title: item.title,
          processingStatus: 'idle',
          isRead: false,
        };
      },
    },
    store: {
      selectedPaperId: paper.id,
      selectedPaper: paper,
      markSaved() {},
      async refresh() {
        refreshCalls += 1;
      },
    },
  });

  assert.deepEqual(saveCalls, ['paper:2503.00001']);
  assert.equal(refreshCalls, 1);
});
