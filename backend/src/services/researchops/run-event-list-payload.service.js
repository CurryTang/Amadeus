'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeEvent(event = null) {
  const source = event && typeof event === 'object' ? event : {};
  return {
    id: cleanString(source.id) || null,
    runId: cleanString(source.runId) || null,
    sequence: Number.isFinite(Number(source.sequence)) ? Number(source.sequence) : null,
    eventType: cleanString(source.eventType) || null,
    status: cleanString(source.status).toUpperCase() || null,
    message: cleanString(source.message) || null,
    progress: Number.isFinite(Number(source.progress)) ? Number(source.progress) : null,
    payload: asObject(source.payload),
    timestamp: cleanString(source.timestamp) || null,
  };
}

function buildRunEventListPayload({
  runId = '',
  afterSequence = '',
  result = {},
} = {}) {
  const source = asObject(result);
  return {
    runId: cleanString(runId) || null,
    filters: {
      afterSequence: cleanString(afterSequence) || null,
    },
    items: (Array.isArray(source.items) ? source.items : []).map((item) => normalizeEvent(item)),
    nextAfterSequence: Number.isFinite(Number(source.nextAfterSequence)) ? Number(source.nextAfterSequence) : null,
  };
}

module.exports = {
  buildRunEventListPayload,
};
