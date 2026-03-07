'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNumericId(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildDocumentActions(groupId = null, documentId = null) {
  const normalizedGroupId = normalizeNumericId(groupId);
  const normalizedDocumentId = normalizeNumericId(documentId);
  if (!normalizedGroupId) return {};
  const encodedGroupId = encodeURIComponent(String(normalizedGroupId));
  const actions = {
    list: {
      method: 'GET',
      path: `/researchops/knowledge-groups/${encodedGroupId}/documents`,
    },
    addDocuments: {
      method: 'POST',
      path: `/researchops/knowledge-groups/${encodedGroupId}/documents`,
    },
  };
  if (normalizedDocumentId) {
    actions.unlink = {
      method: 'DELETE',
      path: `/researchops/knowledge-groups/${encodedGroupId}/documents/${encodeURIComponent(String(normalizedDocumentId))}`,
    };
  }
  return actions;
}

function normalizeDocumentItem(groupId = null, item = null) {
  const source = item && typeof item === 'object' ? item : {};
  const documentId = normalizeNumericId(source.id);
  return {
    ...source,
    id: documentId,
    actions: buildDocumentActions(groupId, documentId),
  };
}

function buildKnowledgeGroupDocumentListPayload({
  groupId = null,
  items = [],
  limit = null,
  offset = null,
  q = '',
} = {}) {
  const normalizedGroupId = normalizeNumericId(groupId);
  return {
    groupId: normalizedGroupId,
    filters: {
      q: cleanString(q) || null,
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    offset: Number.isFinite(Number(offset)) ? Number(offset) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeDocumentItem(normalizedGroupId, item)),
    actions: buildDocumentActions(normalizedGroupId),
  };
}

function buildKnowledgeGroupDocumentMutationPayload({
  groupId = null,
  result = null,
} = {}) {
  const source = result && typeof result === 'object' ? result : {};
  const normalizedGroupId = normalizeNumericId(groupId);
  return {
    groupId: normalizedGroupId,
    added: Number.isFinite(Number(source.added)) ? Number(source.added) : 0,
    ignored: Number.isFinite(Number(source.ignored)) ? Number(source.ignored) : 0,
    validDocumentIds: (Array.isArray(source.validDocumentIds) ? source.validDocumentIds : [])
      .map((item) => normalizeNumericId(item))
      .filter((item) => item !== null),
    actions: buildDocumentActions(normalizedGroupId),
  };
}

function buildKnowledgeGroupDocumentUnlinkPayload({
  groupId = null,
  documentId = null,
  success = null,
} = {}) {
  const normalizedGroupId = normalizeNumericId(groupId);
  const normalizedDocumentId = normalizeNumericId(documentId);
  return {
    groupId: normalizedGroupId,
    documentId: normalizedDocumentId,
    success: typeof success === 'boolean' ? success : null,
    actions: buildDocumentActions(normalizedGroupId, normalizedDocumentId),
  };
}

module.exports = {
  buildKnowledgeGroupDocumentListPayload,
  buildKnowledgeGroupDocumentMutationPayload,
  buildKnowledgeGroupDocumentUnlinkPayload,
};
