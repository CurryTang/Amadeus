'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKnowledgeGroupDocumentListPayload,
  buildKnowledgeGroupDocumentMutationPayload,
  buildKnowledgeGroupDocumentUnlinkPayload,
} = require('../knowledge-group-document-payload.service');

test('buildKnowledgeGroupDocumentListPayload preserves document items while exposing group actions', () => {
  const payload = buildKnowledgeGroupDocumentListPayload({
    groupId: 42,
    items: [
      {
        id: 9,
        title: 'Paper A',
        type: 'paper',
        originalUrl: 'https://example.com/paper',
      },
    ],
    limit: 50,
    offset: 0,
    q: 'paper',
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.limit, 50);
  assert.equal(payload.filters.q, 'paper');
  assert.equal(payload.items[0].id, 9);
  assert.deepEqual(payload.items[0].actions.unlink, {
    method: 'DELETE',
    path: '/researchops/knowledge-groups/42/documents/9',
  });
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/knowledge-groups/42/documents',
  });
  assert.deepEqual(payload.actions.addDocuments, {
    method: 'POST',
    path: '/researchops/knowledge-groups/42/documents',
  });
});

test('buildKnowledgeGroupDocumentMutationPayload exposes list follow-up and valid document ids', () => {
  const payload = buildKnowledgeGroupDocumentMutationPayload({
    groupId: 42,
    result: {
      added: 2,
      ignored: 1,
      validDocumentIds: [9, 10],
    },
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.added, 2);
  assert.equal(payload.ignored, 1);
  assert.deepEqual(payload.validDocumentIds, [9, 10]);
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/knowledge-groups/42/documents',
  });
});

test('buildKnowledgeGroupDocumentUnlinkPayload exposes unlink success and follow-up actions', () => {
  const payload = buildKnowledgeGroupDocumentUnlinkPayload({
    groupId: 42,
    documentId: 9,
    success: true,
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.documentId, 9);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.actions.unlink, {
    method: 'DELETE',
    path: '/researchops/knowledge-groups/42/documents/9',
  });
});
