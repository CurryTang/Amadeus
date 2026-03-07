'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildIdeaActions(ideaId = '') {
  const safeIdeaId = cleanString(ideaId);
  if (!safeIdeaId) return {};
  const encodedIdeaId = encodeURIComponent(safeIdeaId);
  return {
    detail: {
      method: 'GET',
      path: `/researchops/ideas/${encodedIdeaId}`,
    },
    update: {
      method: 'PATCH',
      path: `/researchops/ideas/${encodedIdeaId}`,
    },
  };
}

function normalizeIdea(idea = null) {
  const source = idea && typeof idea === 'object' ? idea : {};
  const ideaId = cleanString(source.id);
  return {
    ...source,
    id: ideaId || null,
    status: cleanString(source.status).toUpperCase() || null,
    actions: buildIdeaActions(ideaId),
  };
}

function buildIdeaPayload({ idea = null } = {}) {
  const normalized = normalizeIdea(idea);
  return {
    ideaId: cleanString(normalized?.id) || null,
    idea: normalized,
    actions: buildIdeaActions(normalized?.id),
  };
}

function buildIdeaListPayload({
  items = [],
  projectId = '',
  status = '',
  limit = null,
} = {}) {
  return {
    filters: {
      projectId: cleanString(projectId) || null,
      status: cleanString(status).toUpperCase() || null,
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeIdea(item)),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/ideas',
      },
      create: {
        method: 'POST',
        path: '/researchops/ideas',
      },
    },
  };
}

module.exports = {
  buildIdeaListPayload,
  buildIdeaPayload,
};
