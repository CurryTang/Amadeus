'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGroupId(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const text = cleanString(value);
  return text || null;
}

function buildKnowledgeGroupActions(groupId = null) {
  const normalizedGroupId = normalizeGroupId(groupId);
  if (!normalizedGroupId) return {};
  const encodedGroupId = encodeURIComponent(String(normalizedGroupId));
  return {
    detail: {
      method: 'GET',
      path: `/researchops/knowledge-groups/${encodedGroupId}`,
    },
    update: {
      method: 'PATCH',
      path: `/researchops/knowledge-groups/${encodedGroupId}`,
    },
    documents: {
      method: 'GET',
      path: `/researchops/knowledge-groups/${encodedGroupId}/documents`,
    },
  };
}

function normalizeKnowledgeGroup(group = null) {
  const source = group && typeof group === 'object' ? group : {};
  const normalizedId = normalizeGroupId(source.id);
  return {
    ...source,
    id: normalizedId,
    actions: buildKnowledgeGroupActions(normalizedId),
  };
}

function buildKnowledgeGroupPayload({ group = null } = {}) {
  const normalized = normalizeKnowledgeGroup(group);
  return {
    groupId: normalized?.id ?? null,
    group: normalized,
    actions: buildKnowledgeGroupActions(normalized?.id),
  };
}

function buildKnowledgeGroupListPayload({
  items = [],
  limit = null,
  offset = null,
  q = '',
} = {}) {
  return {
    filters: {
      q: cleanString(q) || null,
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    offset: Number.isFinite(Number(offset)) ? Number(offset) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeKnowledgeGroup(item)),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/knowledge-groups',
      },
      create: {
        method: 'POST',
        path: '/researchops/knowledge-groups',
      },
    },
  };
}

function buildProjectKnowledgeGroupsPayload({
  projectId = '',
  groupIds = [],
  items = [],
  project = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const encodedProjectId = encodeURIComponent(safeProjectId);
  return {
    projectId: safeProjectId || null,
    groupIds: (Array.isArray(groupIds) ? groupIds : [])
      .map((item) => normalizeGroupId(item))
      .filter((item) => item !== null),
    items: (Array.isArray(items) ? items : []).map((item) => normalizeKnowledgeGroup(item)),
    project: project && typeof project === 'object' ? project : null,
    actions: safeProjectId ? {
      linkedList: {
        method: 'GET',
        path: `/researchops/projects/${encodedProjectId}/knowledge-groups`,
      },
      setLinks: {
        method: 'PUT',
        path: `/researchops/projects/${encodedProjectId}/knowledge-groups`,
      },
    } : {},
  };
}

module.exports = {
  buildKnowledgeGroupActions,
  buildKnowledgeGroupListPayload,
  buildKnowledgeGroupPayload,
  buildProjectKnowledgeGroupsPayload,
};
