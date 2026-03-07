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

module.exports = {
  buildBridgeNoteArtifactInput,
};
