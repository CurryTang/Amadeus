'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectFileSearchPayload } = require('../project-file-search-payload.service');

test('buildProjectFileSearchPayload preserves items while exposing search metadata and actions', () => {
  const payload = buildProjectFileSearchPayload({
    projectId: 'proj_1',
    scope: 'kb',
    query: 'paper',
    limit: 20,
    rootMode: 'kb-folder',
    items: ['resource/README.md'],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.scope, 'kb');
  assert.equal(payload.query, 'paper');
  assert.equal(payload.limit, 20);
  assert.equal(payload.rootMode, 'kb-folder');
  assert.deepEqual(payload.items, ['resource/README.md']);
  assert.deepEqual(payload.actions.search, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/search',
  });
});
