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

test('buildNodeReviewSummary includes thin compare rows when compare payload is present', () => {
  const rows = buildNodeReviewSummary(
    {},
    {},
    {
      highlights: {
        deliverableArtifactIds: ['art_summary'],
      },
      bridgeRuntime: {
        supportsLocalBridgeWorkflow: true,
      },
    },
    {
      other: {
        run: {
          id: 'run_alt',
          status: 'FAILED',
        },
        resolvedTransport: 'daemon-task',
        execution: {
          location: 'remote',
          backend: 'container',
          runtimeClass: 'container-fast',
        },
        contract: {
          ok: false,
        },
        report: {
          observability: {
            statuses: {
              readiness: 'needs_attention',
            },
            counts: {
              warnings: 2,
            },
            sinkProviders: ['wandb', 'tensorboard'],
          },
          workspaceSnapshot: {
            localSnapshot: {
              kind: 'workspace_patch',
            },
          },
          highlights: {
            deliverableArtifactIds: ['art_alt'],
          },
        },
      },
      relation: {
        sameNode: true,
      },
    }
  );

  assert.deepEqual(rows, [
    { label: 'Evidence', value: '1 deliverable artifact' },
    { label: 'Bridge', value: 'Local bridge ready' },
    { label: 'Compare', value: 'run_alt' },
    { label: 'Compare Status', value: 'FAILED' },
    { label: 'Compare Node', value: 'Same node' },
    { label: 'Compare Readiness', value: 'Needs attention' },
    { label: 'Compare Warnings', value: '2 warnings' },
    { label: 'Compare Sinks', value: 'wandb, tensorboard' },
    { label: 'Compare Execution', value: 'remote' },
    { label: 'Compare Runtime', value: 'container/container-fast' },
    { label: 'Compare Transport', value: 'daemon-task' },
    { label: 'Compare Contract', value: 'Validation failed' },
    { label: 'Compare Snapshot', value: 'Snapshot-backed' },
    { label: 'Compare Evidence', value: '1 deliverable artifact' },
  ]);
});

test('buildNodeReviewSummary falls back to thin compare snapshot views when compare report is absent', () => {
  const rows = buildNodeReviewSummary(
    {},
    {},
    {},
    {
      other: {
        run: {
          id: 'run_thin_compare',
          status: 'SUCCEEDED',
        },
        resolvedTransport: 'rust-daemon',
        execution: {
          location: 'remote',
          backend: 'container',
          runtimeClass: 'container-guarded',
        },
        contract: {
          ok: true,
        },
        workspaceSnapshot: {
          localSnapshot: {
            kind: 'git_diff',
          },
        },
      },
      relation: {
        sameNode: false,
      },
    },
    null
  );

  assert.deepEqual(rows, [
    { label: 'Evidence', value: 'No deliverable artifacts yet' },
    { label: 'Compare', value: 'run_thin_compare' },
    { label: 'Compare Status', value: 'SUCCEEDED' },
    { label: 'Compare Execution', value: 'remote' },
    { label: 'Compare Runtime', value: 'container/container-guarded' },
    { label: 'Compare Transport', value: 'rust-daemon' },
    { label: 'Compare Contract', value: 'Validated' },
    { label: 'Compare Snapshot', value: 'Snapshot-backed' },
    { label: 'Compare Evidence', value: 'No deliverable artifacts yet' },
  ]);
});

test('buildNodeReviewSummary surfaces observability readiness and warning counts when present', () => {
  const rows = buildNodeReviewSummary(
    {},
    {},
    {
      highlights: {
        deliverableArtifactIds: ['art_summary'],
      },
      observability: {
        statuses: {
          readiness: 'needs_attention',
        },
        counts: {
          warnings: 2,
        },
        sinkProviders: ['wandb', 'tensorboard'],
      },
    }
  );

  assert.deepEqual(rows, [
    { label: 'Evidence', value: '1 deliverable artifact' },
    { label: 'Readiness', value: 'Needs attention' },
    { label: 'Warnings', value: '2 warnings' },
    { label: 'Sinks', value: 'wandb, tensorboard' },
  ]);
});

test('buildNodeReviewSummary falls back to bridge report data when no active run report is loaded', () => {
  const rows = buildNodeReviewSummary(
    {},
    {},
    {},
    {},
    {
      bridgeRuntime: {
        supportsLocalBridgeWorkflow: true,
      },
      report: {
        checkpoints: [
          { id: 'cp_pending', status: 'PENDING' },
          { id: 'cp_done', status: 'APPROVED' },
        ],
        highlights: {
          deliverableArtifactIds: ['art_summary'],
        },
        observability: {
          statuses: {
            readiness: 'ready',
          },
          counts: {
            warnings: 0,
          },
          sinkProviders: ['wandb'],
        },
      },
    }
  );

  assert.deepEqual(rows, [
    { label: 'Checkpoints', value: '1 pending · 1 resolved' },
    { label: 'Evidence', value: '1 deliverable artifact' },
    { label: 'Readiness', value: 'Ready' },
    { label: 'Sinks', value: 'wandb' },
    { label: 'Bridge', value: 'Local bridge ready' },
  ]);
});
