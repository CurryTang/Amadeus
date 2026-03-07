'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildBridgeNoteArtifactInput({
  title = '',
  content = '',
  noteType = '',
} = {}) {
  const text = typeof content === 'string' ? content : '';
  return {
    kind: 'bridge_note_md',
    title: cleanString(title) || 'Bridge Note',
    path: null,
    mimeType: 'text/markdown',
    objectKey: null,
    objectUrl: null,
    metadata: {
      source: 'bridge',
      noteType: cleanString(noteType) || 'note',
      inlinePreview: text,
      contentLength: text.length,
    },
  };
}

function buildBridgeNotePayload({
  runId = '',
  artifact = null,
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    ok: true,
    runId: safeRunId || null,
    artifact: artifact && typeof artifact === 'object' ? artifact : null,
    actions: safeRunId ? {
      bridgeNote: {
        method: 'POST',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}/bridge-note`,
      },
      runDetail: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}`,
      },
    } : {},
  };
}

module.exports = {
  buildBridgeNoteArtifactInput,
  buildBridgeNotePayload,
};
