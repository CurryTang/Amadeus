const test = require('node:test');
const assert = require('node:assert/strict');

const uploadRouter = require('../upload');

test('resolveArxivUploadMetadata uses provided feed metadata without calling arXiv', async () => {
  let fetchCalls = 0;

  const metadata = await uploadRouter.resolveArxivUploadMetadata({
    arxivId: '2501.12345',
    providedMetadata: {
      title: 'Tracker Paper Title',
      abstract: 'Tracker summary',
      authors: ['Author A', 'Author B'],
      published: '2026-03-13T00:00:00Z',
      primaryCategory: 'cs.LG',
      absUrl: 'https://arxiv.org/abs/2501.12345',
    },
    fetchMetadata: async () => {
      fetchCalls += 1;
      return {};
    },
  });

  assert.equal(fetchCalls, 0);
  assert.equal(metadata.title, 'Tracker Paper Title');
  assert.equal(metadata.abstract, 'Tracker summary');
  assert.deepEqual(metadata.authors, ['Author A', 'Author B']);
  assert.equal(metadata.primaryCategory, 'cs.LG');
});

test('resolveArxivUploadMetadata falls back to provided metadata when arXiv returns 429', async () => {
  const metadata = await uploadRouter.resolveArxivUploadMetadata({
    arxivId: '2501.12345',
    providedMetadata: {
      title: 'Tracker Paper Title',
      abstract: 'Short feed summary',
      authors: ['Author A'],
      published: '2026-03-13T00:00:00Z',
      absUrl: 'https://arxiv.org/abs/2501.12345',
    },
    fetchMetadata: async () => {
      throw new Error('arXiv metadata request failed: HTTP 429');
    },
  });

  assert.equal(metadata.title, 'Tracker Paper Title');
  assert.equal(metadata.abstract, 'Short feed summary');
  assert.deepEqual(metadata.authors, ['Author A']);
  assert.equal(metadata.absUrl, 'https://arxiv.org/abs/2501.12345');
});
