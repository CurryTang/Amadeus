'use strict';

const { normalizeObservedSessionClassification } = require('./observed-session.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildObservedSessionActions(projectId = '', item = {}) {
  const normalizedProjectId = cleanString(projectId);
  const itemId = cleanString(item?.id) || cleanString(item?.sessionId);
  if (!normalizedProjectId || !itemId) return {};
  const encodedProjectId = encodeURIComponent(normalizedProjectId);
  const encodedItemId = encodeURIComponent(itemId);
  return {
    detail: {
      method: 'GET',
      path: `/researchops/projects/${encodedProjectId}/observed-sessions/${encodedItemId}`,
    },
    refresh: {
      method: 'POST',
      path: `/researchops/projects/${encodedProjectId}/observed-sessions/${encodedItemId}/refresh`,
    },
  };
}

function normalizeObservedSessionItem(item = {}, { projectId = '' } = {}) {
  const detachedNodeId = cleanString(item?.detachedNodeId);
  return {
    ...(item && typeof item === 'object' ? item : {}),
    status: cleanString(item?.status).toUpperCase() || 'UNKNOWN',
    classification: normalizeObservedSessionClassification(item?.classification || {}),
    hasDetachedNode: typeof item?.hasDetachedNode === 'boolean'
      ? item.hasDetachedNode
      : Boolean(detachedNodeId),
    detachedNodeId,
    detachedNodeTitle: cleanString(item?.detachedNodeTitle),
    materialization: cleanString(item?.materialization) || 'none',
    actions: buildObservedSessionActions(projectId, item),
  };
}

function buildObservedSessionListPayload({
  projectId = '',
  items = [],
  wrotePlan = false,
  refreshedAt = '',
  cached,
} = {}) {
  const payload = {
    projectId,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeObservedSessionItem(item, { projectId })),
    wrotePlan: Boolean(wrotePlan),
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    actions: projectId ? {
      list: {
        method: 'GET',
        path: `/researchops/projects/${encodeURIComponent(projectId)}/observed-sessions`,
      },
    } : {},
  };
  if (typeof cached === 'boolean') {
    payload.cached = cached;
  }
  return payload;
}

function buildObservedSessionItemPayload({
  projectId = '',
  item = null,
  wrotePlan = false,
  refreshedAt = '',
} = {}) {
  return {
    projectId,
    item: item && typeof item === 'object' ? normalizeObservedSessionItem(item, { projectId }) : null,
    wrotePlan: Boolean(wrotePlan),
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
  };
}

module.exports = {
  buildObservedSessionItemPayload,
  buildObservedSessionListPayload,
  normalizeObservedSessionItem,
};
