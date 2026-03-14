const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildArxivSaveRequest,
  shouldFetchArxivMetadata,
} = require('./arxiv-save-helpers.js');

test('buildArxivSaveRequest includes fallback metadata for backend save recovery', () => {
  const payload = buildArxivSaveRequest({
    arxivId: '2501.12345',
    title: 'Paper Title',
    authors: ['Author A', 'Author B'],
    abstract: 'Paper abstract',
    absUrl: 'https://arxiv.org/abs/2501.12345',
    categories: ['cs.LG', 'cs.AI'],
  }, {
    title: '',
    tags: ['agent'],
    notes: 'Saved from extension',
    analysisProvider: 'codex-cli',
  });

  assert.deepEqual(payload, {
    paperId: '2501.12345',
    title: 'Paper Title',
    tags: ['agent'],
    notes: 'Saved from extension',
    analysisProvider: 'codex-cli',
    abstract: 'Paper abstract',
    authors: ['Author A', 'Author B'],
    publishedAt: '',
    primaryCategory: 'cs.LG',
    absUrl: 'https://arxiv.org/abs/2501.12345',
  });
});

test('shouldFetchArxivMetadata only when popup lacks usable metadata', () => {
  assert.equal(shouldFetchArxivMetadata({
    arxivId: '2501.12345',
    title: 'Paper Title',
    authors: ['Author A'],
    abstract: '',
  }), false);

  assert.equal(shouldFetchArxivMetadata({
    arxivId: '2501.12345',
    title: 'Paper Title',
    authors: [],
    abstract: 'Paper abstract',
  }), false);

  assert.equal(shouldFetchArxivMetadata({
    arxivId: '2501.12345',
    title: '',
    authors: [],
    abstract: '',
  }), true);

  assert.equal(shouldFetchArxivMetadata({
    arxivId: '2501.12345',
    title: 'arXiv:2501.12345',
    authors: [],
    abstract: '',
  }), true);
});
