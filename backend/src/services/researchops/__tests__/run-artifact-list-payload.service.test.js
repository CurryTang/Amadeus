'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunArtifactListPayload } = require('../run-artifact-list-payload.service');

test('buildRunArtifactListPayload normalizes artifact items with download actions', () => {
  const payload = buildRunArtifactListPayload({
    runId: 'run_1',
    items: [
      {
        id: 'art_summary',
        kind: 'run_summary_md',
        title: 'Summary',
        objectUrl: 'https://example.com/object',
      },
      {
        id: 'art_deliverable',
        kind: 'deliverable_report',
        title: 'Deliverable',
      },
    ],
  });

  assert.equal(payload.runId, 'run_1');
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].actions.download.path, '/researchops/runs/run_1/artifacts/art_summary/download');
  assert.equal(payload.items[0].isDeliverable, false);
  assert.equal(payload.items[1].isDeliverable, true);
  assert.deepEqual(payload.filters, {
    kind: null,
  });
});

test('buildRunArtifactListPayload carries through requested kind filter', () => {
  const payload = buildRunArtifactListPayload({
    runId: 'run_2',
    kind: 'deliverable_report',
    items: [],
  });

  assert.equal(payload.filters.kind, 'deliverable_report');
});
