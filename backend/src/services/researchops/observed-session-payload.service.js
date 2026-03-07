'use strict';

const { normalizeObservedSessionClassification } = require('./observed-session.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeObservedSessionItem(item = {}) {
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
  };
}

function buildObservedSessionListPayload({
  projectId = '',
  items = [],
  wrotePlan = false,
  refreshedAt = '',
} = {}) {
  return {
    projectId,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeObservedSessionItem(item)),
    wrotePlan: Boolean(wrotePlan),
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
  };
}

function buildObservedSessionItemPayload({
  projectId = '',
  item = null,
  wrotePlan = false,
  refreshedAt = '',
} = {}) {
  return {
    projectId,
    item: item && typeof item === 'object' ? normalizeObservedSessionItem(item) : null,
    wrotePlan: Boolean(wrotePlan),
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
  };
}

module.exports = {
  buildObservedSessionItemPayload,
  buildObservedSessionListPayload,
  normalizeObservedSessionItem,
};
