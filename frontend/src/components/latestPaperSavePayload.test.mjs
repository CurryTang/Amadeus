import test from 'node:test';
import assert from 'node:assert/strict';

import { buildArxivSavePayload } from './latestPaperSavePayload.js';

test('buildArxivSavePayload includes tracker metadata needed for arXiv fallback saves', () => {
  const payload = buildArxivSavePayload({
    arxivId: '2501.12345',
    title: 'Tracker Title',
    summary: 'Tracker summary',
    authors: ['Author A', 'Author B'],
    publishedAt: '2026-03-13T00:00:00Z',
    primaryCategory: 'cs.LG',
  });

  assert.deepEqual(payload, {
    paperId: '2501.12345',
    title: 'Tracker Title',
    abstract: 'Tracker summary',
    authors: ['Author A', 'Author B'],
    publishedAt: '2026-03-13T00:00:00Z',
    primaryCategory: 'cs.LG',
    absUrl: 'https://arxiv.org/abs/2501.12345',
  });
});

test('buildArxivSavePayload falls back to abstract and rejects missing arXiv ids', () => {
  assert.deepEqual(
    buildArxivSavePayload({
      arxivId: '2501.54321',
      title: 'Fallback Title',
      abstract: 'Abstract body',
      authors: 'not-an-array',
    }),
    {
      paperId: '2501.54321',
      title: 'Fallback Title',
      abstract: 'Abstract body',
      authors: [],
      publishedAt: '',
      primaryCategory: '',
      absUrl: 'https://arxiv.org/abs/2501.54321',
    }
  );

  assert.equal(buildArxivSavePayload({ title: 'No ID' }), null);
});
