'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildKbSearchPayload } = require('../kb-search-payload.service');

test('buildKbSearchPayload preserves source/items while exposing search metadata and actions', () => {
  const payload = buildKbSearchPayload({
    query: 'paper',
    topK: 5,
    result: {
      source: 'fallback-metadata',
      items: [
        {
          kind: 'idea',
          id: 'idea_1',
          title: 'Investigate paper',
          text: 'Paper summary',
        },
      ],
    },
  });

  assert.equal(payload.query, 'paper');
  assert.equal(payload.topK, 5);
  assert.equal(payload.source, 'fallback-metadata');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'idea_1');
  assert.deepEqual(payload.actions.search, {
    method: 'POST',
    path: '/researchops/kb/search',
  });
});
