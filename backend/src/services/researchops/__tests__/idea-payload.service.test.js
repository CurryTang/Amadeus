'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildIdeaListPayload,
  buildIdeaPayload,
} = require('../idea-payload.service');

test('buildIdeaPayload preserves the idea root while exposing follow-up actions', () => {
  const payload = buildIdeaPayload({
    idea: {
      id: 'idea_1',
      projectId: 'proj_1',
      title: 'Investigate failure mode',
      status: 'open',
    },
  });

  assert.equal(payload.ideaId, 'idea_1');
  assert.equal(payload.idea.id, 'idea_1');
  assert.equal(payload.idea.status, 'OPEN');
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/ideas/idea_1',
  });
  assert.deepEqual(payload.actions.update, {
    method: 'PATCH',
    path: '/researchops/ideas/idea_1',
  });
});

test('buildIdeaListPayload keeps idea items compatible while exposing filters and actions', () => {
  const payload = buildIdeaListPayload({
    items: [
      {
        id: 'idea_1',
        projectId: 'proj_1',
        title: 'Investigate failure mode',
        status: 'open',
      },
    ],
    projectId: 'proj_1',
    status: 'OPEN',
    limit: 50,
  });

  assert.equal(payload.limit, 50);
  assert.equal(payload.filters.projectId, 'proj_1');
  assert.equal(payload.filters.status, 'OPEN');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'idea_1');
  assert.equal(payload.items[0].status, 'OPEN');
  assert.deepEqual(payload.items[0].actions.detail, {
    method: 'GET',
    path: '/researchops/ideas/idea_1',
  });
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/ideas',
  });
});
