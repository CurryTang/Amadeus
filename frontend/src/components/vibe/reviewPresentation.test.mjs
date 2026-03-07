import test from 'node:test';
import assert from 'node:assert/strict';

import { buildNodeReviewSummary } from './reviewPresentation.js';

test('buildNodeReviewSummary highlights pending gate, checkpoints, and evidence counts', () => {
  const rows = buildNodeReviewSummary(
    {
      checks: [{ type: 'manual_approve', name: 'scope_gate' }],
    },
    {
      manualApproved: false,
    },
    {
      checkpoints: [
        { id: 'cp_pending', status: 'PENDING' },
        { id: 'cp_done', status: 'APPROVED' },
      ],
      highlights: {
        deliverableArtifactIds: ['art_summary', 'art_final'],
        summaryArtifactId: 'art_summary',
        finalOutputArtifactId: 'art_final',
      },
    }
  );

  assert.deepEqual(rows, [
    { label: 'Gate', value: 'Awaiting manual approval' },
    { label: 'Checkpoints', value: '1 pending · 1 resolved' },
    { label: 'Evidence', value: '2 deliverable artifacts' },
  ]);
});

test('buildNodeReviewSummary handles approved gates and empty evidence gracefully', () => {
  const rows = buildNodeReviewSummary(
    {
      checks: [{ type: 'manual_approve', name: 'release_gate' }],
    },
    {
      manualApproved: true,
    },
    {
      checkpoints: [],
      highlights: {
        deliverableArtifactIds: [],
      },
    }
  );

  assert.deepEqual(rows, [
    { label: 'Gate', value: 'Approved' },
    { label: 'Evidence', value: 'No deliverable artifacts yet' },
  ]);
});
