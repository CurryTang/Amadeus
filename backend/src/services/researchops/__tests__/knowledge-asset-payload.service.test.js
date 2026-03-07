'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKnowledgeAssetListPayload,
  buildKnowledgeAssetPayload,
  buildKnowledgeGroupAssetsPayload,
} = require('../knowledge-asset-payload.service');

test('buildKnowledgeAssetPayload preserves the asset root while exposing detail actions', () => {
  const payload = buildKnowledgeAssetPayload({
    asset: {
      id: 7,
      assetType: 'note',
      title: 'Resource Extract',
      sourceProvider: 'manual',
    },
  });

  assert.equal(payload.assetId, 7);
  assert.equal(payload.asset.id, 7);
  assert.equal(payload.asset.assetType, 'note');
  assert.deepEqual(payload.asset.actions.detail, {
    method: 'GET',
    path: '/researchops/knowledge/assets/7',
  });
  assert.deepEqual(payload.actions.update, {
    method: 'PATCH',
    path: '/researchops/knowledge/assets/7',
  });
});

test('buildKnowledgeAssetListPayload keeps asset items compatible while exposing filters and actions', () => {
  const payload = buildKnowledgeAssetListPayload({
    items: [
      {
        id: 7,
        assetType: 'note',
        title: 'Resource Extract',
        sourceProvider: 'manual',
      },
    ],
    limit: 200,
    offset: 0,
    q: 'resource',
    assetType: 'note',
    provider: 'manual',
    groupId: 42,
    includeBody: false,
  });

  assert.equal(payload.limit, 200);
  assert.equal(payload.offset, 0);
  assert.equal(payload.filters.q, 'resource');
  assert.equal(payload.filters.assetType, 'note');
  assert.equal(payload.filters.provider, 'manual');
  assert.equal(payload.filters.groupId, 42);
  assert.equal(payload.filters.includeBody, false);
  assert.equal(payload.items[0].id, 7);
  assert.deepEqual(payload.items[0].actions.detail, {
    method: 'GET',
    path: '/researchops/knowledge/assets/7',
  });
  assert.deepEqual(payload.actions.create, {
    method: 'POST',
    path: '/researchops/knowledge/assets',
  });
});

test('buildKnowledgeGroupAssetsPayload preserves linked asset items while exposing group actions', () => {
  const payload = buildKnowledgeGroupAssetsPayload({
    groupId: 42,
    items: [
      {
        id: 7,
        assetType: 'note',
        title: 'Resource Extract',
      },
    ],
    limit: 100,
    offset: 0,
    q: 'extract',
    includeBody: true,
  });

  assert.equal(payload.groupId, 42);
  assert.equal(payload.limit, 100);
  assert.equal(payload.filters.q, 'extract');
  assert.equal(payload.filters.includeBody, true);
  assert.equal(payload.items[0].id, 7);
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/knowledge/groups/42/assets',
  });
  assert.deepEqual(payload.actions.addAssets, {
    method: 'POST',
    path: '/researchops/knowledge/groups/42/assets',
  });
});
