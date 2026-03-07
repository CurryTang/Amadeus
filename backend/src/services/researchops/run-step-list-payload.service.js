'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeStep(step = null) {
  const source = step && typeof step === 'object' ? step : {};
  return {
    id: cleanString(source.id) || null,
    runId: cleanString(source.runId) || null,
    status: cleanString(source.status).toUpperCase() || null,
    message: cleanString(source.message) || null,
    progress: Number.isFinite(Number(source.progress)) ? Number(source.progress) : null,
    payload: asObject(source.payload),
    timestamp: cleanString(source.timestamp) || null,
  };
}

function buildRunStepListPayload({
  runId = '',
  items = [],
} = {}) {
  return {
    runId: cleanString(runId) || null,
    items: (Array.isArray(items) ? items : []).map((item) => normalizeStep(item)),
  };
}

module.exports = {
  buildRunStepListPayload,
};
