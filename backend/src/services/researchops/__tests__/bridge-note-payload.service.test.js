'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBridgeNoteArtifactInput,
  buildBridgeNotePayload,
} = require('../bridge-note-payload.service');

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

test('buildBridgeNotePayload preserves artifact root while exposing follow-up actions', () => {
  const payload = buildBridgeNotePayload({
    runId: 'run_1',
    artifact: {
      id: 'art_1',
      title: 'Bridge Note',
      objectUrl: '/download',
    },
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.artifact.id, 'art_1');
  assert.deepEqual(payload.actions.bridgeNote, {
    method: 'POST',
    path: '/researchops/runs/run_1/bridge-note',
  });
  assert.deepEqual(payload.actions.runDetail, {
    method: 'GET',
    path: '/researchops/runs/run_1',
  });
  assert.deepEqual(payload.submitHints.bridgeNote, {
    body: {
      transport: '"http"|"daemon-task"',
      title: 'string',
      content: 'string',
      noteType: 'string',
    },
  });
});
