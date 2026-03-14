import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTrackedPaperDetailHtml } from '../../webview/templates/trackedPaperDetailHtml';

test('renderTrackedPaperDetailHtml includes paper metadata and save action', () => {
  const html = renderTrackedPaperDetailHtml({
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
  });

  assert.match(html, /Test Paper/);
  assert.match(html, /Ada Lovelace/);
  assert.match(html, /Save to Library/);
});
