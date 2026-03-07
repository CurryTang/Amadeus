'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAssetId(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const text = cleanString(value);
  return text || null;
}

function normalizeGroupId(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const text = cleanString(value);
  return text || null;
}

function buildKnowledgeAssetActions(assetId = null) {
  const normalizedAssetId = normalizeAssetId(assetId);
  if (!normalizedAssetId) return {};
  const encodedAssetId = encodeURIComponent(String(normalizedAssetId));
  return {
    detail: {
      method: 'GET',
      path: `/researchops/knowledge/assets/${encodedAssetId}`,
    },
    update: {
      method: 'PATCH',
      path: `/researchops/knowledge/assets/${encodedAssetId}`,
    },
  };
}

function normalizeKnowledgeAsset(asset = null) {
  const source = asset && typeof asset === 'object' ? asset : {};
  const normalizedId = normalizeAssetId(source.id);
  return {
    ...source,
    id: normalizedId,
    actions: buildKnowledgeAssetActions(normalizedId),
  };
}

function buildKnowledgeAssetPayload({ asset = null } = {}) {
  const normalized = normalizeKnowledgeAsset(asset);
  return {
    assetId: normalized?.id ?? null,
    asset: normalized,
    actions: buildKnowledgeAssetActions(normalized?.id),
  };
}

function buildKnowledgeAssetListPayload({
  items = [],
  limit = null,
  offset = null,
  q = '',
  assetType = '',
  provider = '',
  groupId = null,
  includeBody = false,
} = {}) {
  return {
    filters: {
      q: cleanString(q) || null,
      assetType: cleanString(assetType) || null,
      provider: cleanString(provider) || null,
      groupId: normalizeGroupId(groupId),
      includeBody: Boolean(includeBody),
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    offset: Number.isFinite(Number(offset)) ? Number(offset) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeKnowledgeAsset(item)),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/knowledge/assets',
      },
      create: {
        method: 'POST',
        path: '/researchops/knowledge/assets',
      },
      upload: {
        method: 'POST',
        path: '/researchops/knowledge/assets/upload',
      },
    },
  };
}

function buildKnowledgeGroupAssetsPayload({
  groupId = null,
  items = [],
  limit = null,
  offset = null,
  q = '',
  includeBody = false,
} = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  const encodedGroupId = normalizedGroupId === null ? '' : encodeURIComponent(String(normalizedGroupId));
  return {
    groupId: normalizedGroupId,
    filters: {
      q: cleanString(q) || null,
      includeBody: Boolean(includeBody),
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    offset: Number.isFinite(Number(offset)) ? Number(offset) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeKnowledgeAsset(item)),
    actions: normalizedGroupId === null ? {} : {
      list: {
        method: 'GET',
        path: `/researchops/knowledge/groups/${encodedGroupId}/assets`,
      },
      addAssets: {
        method: 'POST',
        path: `/researchops/knowledge/groups/${encodedGroupId}/assets`,
      },
    },
  };
}

function buildKnowledgeGroupAssetMutationPayload({
  groupId = null,
  assetId = null,
  result = null,
  success = null,
} = {}) {
  const normalizedGroupId = normalizeGroupId(groupId);
  const normalizedAssetId = normalizeAssetId(assetId);
  const source = result && typeof result === 'object' ? result : {};
  const base = buildKnowledgeGroupAssetsPayload({ groupId: normalizedGroupId });
  if (normalizedAssetId !== null) {
    base.actions.removeAsset = {
      method: 'DELETE',
      path: `/researchops/knowledge/groups/${encodeURIComponent(String(normalizedGroupId))}/assets/${encodeURIComponent(String(normalizedAssetId))}`,
    };
  }
  return {
    groupId: normalizedGroupId,
    assetId: normalizedAssetId,
    success: typeof success === 'boolean' ? success : null,
    added: Number.isFinite(Number(source.added)) ? Number(source.added) : 0,
    ignored: Number.isFinite(Number(source.ignored)) ? Number(source.ignored) : 0,
    validAssetIds: (Array.isArray(source.validAssetIds) ? source.validAssetIds : [])
      .map((item) => normalizeAssetId(item))
      .filter((item) => item !== null),
    actions: base.actions,
  };
}

module.exports = {
  buildKnowledgeAssetListPayload,
  buildKnowledgeAssetPayload,
  buildKnowledgeGroupAssetsPayload,
  buildKnowledgeGroupAssetMutationPayload,
};
