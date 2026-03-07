'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKnowledgeGroupListPayload,
  buildKnowledgeGroupPayload,
  buildProjectKnowledgeGroupsPayload,
  buildKnowledgeGroupDeletePayload,
} = require('../knowledge-group-payload.service');

test('buildKnowledgeGroupPayload preserves the group root while exposing detail actions', () => {
  const payload = buildKnowledgeGroupPayload({
    group: {
      id: 42,
      name: 'Papers',
      documentCount: 3,
    },
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.group.id, 42);
  assert.equal(payload.group.name, 'Papers');
  assert.deepEqual(payload.group.actions.detail, {
    method: 'GET',
    path: '/researchops/knowledge-groups/42',
  });
  assert.deepEqual(payload.actions.update, {
    method: 'PATCH',
    path: '/researchops/knowledge-groups/42',
  });
});

test('buildKnowledgeGroupListPayload keeps group items compatible while exposing list actions', () => {
  const payload = buildKnowledgeGroupListPayload({
    items: [
      {
        id: 42,
        name: 'Papers',
        documentCount: 3,
      },
    ],
    limit: 200,
    offset: 0,
    q: 'paper',
  });

  assert.equal(payload.limit, 200);
  assert.equal(payload.offset, 0);
  assert.equal(payload.filters.q, 'paper');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 42);
  assert.equal(payload.items[0].documentCount, 3);
  assert.deepEqual(payload.items[0].actions.update, {
    method: 'PATCH',
    path: '/researchops/knowledge-groups/42',
  });
  assert.deepEqual(payload.actions.create, {
    method: 'POST',
    path: '/researchops/knowledge-groups',
  });
});

test('buildProjectKnowledgeGroupsPayload preserves linked group items while exposing project actions', () => {
  const payload = buildProjectKnowledgeGroupsPayload({
    projectId: 'proj_1',
    groupIds: [42],
    items: [
      {
        id: 42,
        name: 'Papers',
        documentCount: 3,
      },
    ],
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.deepEqual(payload.groupIds, [42]);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.knowledgeGroups.length, 1);
  assert.equal(payload.items[0].id, 42);
  assert.equal(payload.knowledgeGroups[0].id, 42);
  assert.deepEqual(payload.actions.linkedList, {
    method: 'GET',
    path: '/researchops/projects/proj_1/knowledge-groups',
  });
  assert.deepEqual(payload.actions.setLinks, {
    method: 'PUT',
    path: '/researchops/projects/proj_1/knowledge-groups',
  });
});

test('buildKnowledgeGroupDeletePayload exposes delete success with follow-up actions', () => {
  const payload = buildKnowledgeGroupDeletePayload({
    groupId: 42,
    success: true,
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/knowledge-groups/42',
  });
  assert.deepEqual(payload.actions.delete, {
    method: 'DELETE',
    path: '/researchops/knowledge-groups/42',
  });
});
