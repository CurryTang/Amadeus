'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildThinRunOutputView } = require('../run-thin-output-view.service');

test('buildThinRunOutputView exposes thin output flags from run highlights', () => {
  const view = buildThinRunOutputView({
    summary: 'Completed run summary',
    highlights: {
      summaryArtifactId: 'art_summary',
      finalOutputArtifactId: 'art_final',
      deliverableArtifactIds: ['art_summary', 'art_final'],
    },
  });

  assert.deepEqual(view, {
    hasSummary: true,
    hasFinalOutput: true,
    deliverableArtifactIds: ['art_summary', 'art_final'],
    summaryArtifactId: 'art_summary',
    finalOutputArtifactId: 'art_final',
  });
});

test('buildThinRunOutputView falls back to empty thin output state', () => {
  const view = buildThinRunOutputView({});

  assert.deepEqual(view, {
    hasSummary: false,
    hasFinalOutput: false,
    deliverableArtifactIds: [],
    summaryArtifactId: null,
    finalOutputArtifactId: null,
  });
});
