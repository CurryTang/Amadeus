'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeNoteArtifactInput } = require('../bridge-note-payload.service');

test('buildBridgeNoteArtifactInput creates a markdown artifact payload for bridge notes', () => {
  const payload = buildBridgeNoteArtifactInput({
    title: 'Local analysis note',
    content: '# Summary\nRegression only appears on seed 4.',
    noteType: 'analysis',
  });

  assert.deepEqual(payload, {
    kind: 'bridge_note_md',
    title: 'Local analysis note',
    path: null,
    mimeType: 'text/markdown',
    objectKey: null,
    objectUrl: null,
    metadata: {
      source: 'bridge',
      noteType: 'analysis',
      inlinePreview: '# Summary\nRegression only appears on seed 4.',
      contentLength: 44,
    },
  });
});
