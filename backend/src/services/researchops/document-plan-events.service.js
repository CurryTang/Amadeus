'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonPayload(raw = '') {
  try {
    return JSON.parse(String(raw || '').trim());
  } catch (_) {
    return null;
  }
}

function parseDocumentPlanEventLine(line = '') {
  const raw = String(line || '').trim();
  const match = raw.match(/^DOCUMENT_STEP_EVENT\s+(\{[\s\S]*\})$/);
  if (!match) return null;
  const payload = parseJsonPayload(match[1]);
  if (!payload || typeof payload !== 'object') return null;
  const progress = Number(payload.progress);
  return {
    eventType: 'STEP_PROGRESS',
    status: cleanString(payload.status).toUpperCase() || null,
    message: cleanString(payload.message) || null,
    progress: Number.isFinite(progress) ? progress : null,
    payload: {
      stepId: cleanString(payload.stepId || payload.step_id),
      nodeId: cleanString(payload.nodeId || payload.node_id),
      status: cleanString(payload.status),
    },
  };
}

module.exports = {
  parseDocumentPlanEventLine,
};
