const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTrackerArxivFeedMetadataState,
  enrichTrackerFeedWithArxivMetadata,
  needsTrackerFeedArxivEnrichment,
} = require('../tracker-arxiv-feed.service');

test('needsTrackerFeedArxivEnrichment only targets weak-title twitter arXiv items', () => {
  assert.equal(needsTrackerFeedArxivEnrichment({
    arxivId: '2501.12345',
    sourceType: 'twitter',
    title: 'arXiv:2501.12345',
    abstract: '',
    authors: [],
  }), true);

  assert.equal(needsTrackerFeedArxivEnrichment({
    arxivId: '2501.12345',
    sourceType: 'twitter',
    title: 'A Real Paper Title',
    abstract: '',
    authors: [],
  }), false);

  assert.equal(needsTrackerFeedArxivEnrichment({
    arxivId: '2501.12345',
    sourceType: 'alphaxiv',
    title: 'arXiv:2501.12345',
    abstract: '',
    authors: [],
  }), false);
});

test('enrichTrackerFeedWithArxivMetadata limits feed-time fetches to weak twitter candidates', async () => {
  const fetchCalls = [];
  const items = [
    { arxivId: '2501.00001', sourceType: 'twitter', title: 'arXiv:2501.00001', abstract: '', authors: [] },
    { arxivId: '2501.00002', sourceType: 'twitter', title: 'arXiv:2501.00002', abstract: '', authors: [] },
    { arxivId: '2501.00003', sourceType: 'twitter', title: 'arXiv:2501.00003', abstract: '', authors: [] },
    { arxivId: '2501.00004', sourceType: 'alphaxiv', title: 'arXiv:2501.00004', abstract: '', authors: [] },
  ];

  const enriched = await enrichTrackerFeedWithArxivMetadata(items, {
    maxEnrich: 2,
    wait: async () => {},
    fetchMetadata: async (arxivId) => {
      fetchCalls.push(arxivId);
      return {
        title: `Canonical ${arxivId}`,
        abstract: `Abstract for ${arxivId}`,
        authors: [`Author ${arxivId}`],
      };
    },
  });

  assert.deepEqual(fetchCalls, ['2501.00001', '2501.00002']);
  assert.equal(enriched[0].title, 'Canonical 2501.00001');
  assert.equal(enriched[1].title, 'Canonical 2501.00002');
  assert.equal(enriched[2].title, 'arXiv:2501.00003');
  assert.equal(enriched[3].title, 'arXiv:2501.00004');
});

test('enrichTrackerFeedWithArxivMetadata reuses cached metadata across calls', async () => {
  const state = createTrackerArxivFeedMetadataState();
  let fetchCalls = 0;

  const item = {
    arxivId: '2501.99999',
    sourceType: 'twitter',
    title: 'arXiv:2501.99999',
    abstract: '',
    authors: [],
  };

  const options = {
    state,
    wait: async () => {},
    fetchMetadata: async () => {
      fetchCalls += 1;
      return {
        title: 'Canonical Cached Title',
        abstract: 'Cached abstract',
        authors: ['Cached Author'],
      };
    },
  };

  await enrichTrackerFeedWithArxivMetadata([item], options);
  const secondPass = await enrichTrackerFeedWithArxivMetadata([item], options);

  assert.equal(fetchCalls, 1);
  assert.equal(secondPass[0].title, 'Canonical Cached Title');
});

test('enrichTrackerFeedWithArxivMetadata waits between network fetches', async () => {
  const waits = [];
  let nowMs = 1000;

  await enrichTrackerFeedWithArxivMetadata([
    { arxivId: '2501.01001', sourceType: 'twitter', title: 'arXiv:2501.01001', abstract: '', authors: [] },
    { arxivId: '2501.01002', sourceType: 'twitter', title: 'arXiv:2501.01002', abstract: '', authors: [] },
  ], {
    minIntervalMs: 3000,
    now: () => nowMs,
    wait: async (ms) => {
      waits.push(ms);
      nowMs += ms;
    },
    fetchMetadata: async (arxivId) => ({
      title: `Canonical ${arxivId}`,
      abstract: '',
      authors: [],
    }),
  });

  assert.deepEqual(waits, [3000]);
});
