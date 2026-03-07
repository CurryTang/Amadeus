import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRecentRunReviewSummary,
  buildRecentRunCards,
  buildContinuationChip,
  filterRunsForSelectedNode,
  getRunSourceLabel,
} from './runPresentation.js';

test('buildRecentRunCards sorts newest runs first and exposes source labels', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_old',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T10:00:00.000Z',
      metadata: {
        prompt: 'Old launcher run',
        sourceType: 'launcher',
      },
    },
    {
      id: 'run_new',
      status: 'RUNNING',
      runType: 'EXPERIMENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        experimentCommand: 'python train.py',
        sourceType: 'tree',
        treeNodeTitle: 'Ablation branch',
      },
    },
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, 'run_new');
  assert.equal(cards[0].sourceLabel, 'Tree');
  assert.equal(cards[0].title, 'python train.py');
  assert.equal(cards[1].id, 'run_old');
  assert.equal(cards[1].sourceLabel, 'Launcher');
});

test('buildRecentRunCards can read linked node titles from attempt-shaped runs', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_attempt',
      status: 'SUCCEEDED',
      runType: 'EXPERIMENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        experimentCommand: 'python eval.py',
      },
      attempt: {
        treeNodeId: 'node_eval',
        treeNodeTitle: 'Evaluation branch',
      },
    },
  ]);

  assert.equal(cards[0].sourceLabel, 'Tree');
  assert.equal(cards[0].linkedNodeTitle, 'Evaluation branch');
});

test('buildRecentRunCards surfaces execution and snapshot labels from normalized run views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_remote_snapshot',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect remote eval',
      },
      execution: {
        location: 'remote',
        backend: 'container',
        runtimeClass: 'container-fast',
        runtimeProfile: {
          isolationTier: 'guarded',
        },
      },
      workspaceSnapshot: {
        localSnapshot: {
          kind: 'git_diff',
        },
      },
    },
    {
      id: 'run_local',
      status: 'RUNNING',
      runType: 'EXPERIMENT',
      createdAt: '2026-03-05T09:00:00.000Z',
      metadata: {
        experimentCommand: 'python local.py',
      },
      execution: {
        location: 'local',
      },
    },
  ]);

  assert.equal(cards[0].executionLabel, 'Remote');
  assert.equal(cards[0].executionRuntimeLabel, 'container/container-fast');
  assert.equal(cards[0].executionIsolationLabel, 'Guarded isolation');
  assert.equal(cards[0].snapshotLabel, 'Snapshot-backed');
  assert.equal(cards[1].executionLabel, '');
  assert.equal(cards[1].executionRuntimeLabel, '');
  assert.equal(cards[1].executionIsolationLabel, '');
  assert.equal(cards[1].snapshotLabel, '');
});

test('buildRecentRunCards surfaces contract-failure labels from normalized contract views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_contract_fail',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect contract failure',
      },
      contract: {
        ok: false,
      },
    },
    {
      id: 'run_contract_ok',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T10:00:00.000Z',
      metadata: {
        prompt: 'Inspect validated run',
      },
      contract: {
        ok: true,
      },
    },
  ]);

  assert.equal(cards[0].contractLabel, 'Validation failed');
  assert.equal(cards[1].contractLabel, '');
});

test('buildRecentRunCards surfaces observability readiness and warnings from normalized views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_obs',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect observability summary',
      },
      observability: {
        statuses: {
          readiness: 'needs_attention',
        },
        counts: {
          warnings: 2,
        },
      },
    },
    {
      id: 'run_no_obs',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T10:00:00.000Z',
      metadata: {
        prompt: 'No observability summary',
      },
    },
  ]);

  assert.equal(cards[0].readinessLabel, 'Needs attention');
  assert.equal(cards[0].warningsLabel, '2 warnings');
  assert.equal(cards[1].readinessLabel, '');
  assert.equal(cards[1].warningsLabel, '');
});

test('buildRecentRunCards surfaces observability sink providers from normalized views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_obs_sinks',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect sink providers',
      },
      observability: {
        sinkProviders: ['wandb', 'tensorboard'],
      },
    },
    {
      id: 'run_obs_no_sinks',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T10:00:00.000Z',
      metadata: {
        prompt: 'No sinks',
      },
      observability: {
        sinkProviders: [],
      },
    },
  ]);

  assert.equal(cards[0].sinkProvidersLabel, 'wandb, tensorboard');
  assert.equal(cards[1].sinkProvidersLabel, '');
});

test('buildRecentRunCards surfaces resolved bridge transport labels from normalized run views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_transport',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect bridge transport',
      },
      resolvedTransport: 'daemon-task',
    },
  ]);

  assert.equal(cards[0].transportLabel, 'via daemon-task');
});

test('buildRecentRunCards surfaces thin output labels from normalized run views', () => {
  const cards = buildRecentRunCards([
    {
      id: 'run_output',
      status: 'SUCCEEDED',
      runType: 'AGENT',
      createdAt: '2026-03-05T11:00:00.000Z',
      metadata: {
        prompt: 'Inspect output presence',
      },
      output: {
        hasSummary: true,
        hasFinalOutput: true,
      },
    },
  ]);

  assert.equal(cards[0].summaryLabel, 'Summary');
  assert.equal(cards[0].finalOutputLabel, 'Final output');
});

test('getRunSourceLabel falls back to linked entities when sourceType is absent', () => {
  assert.equal(getRunSourceLabel({ metadata: { treeNodeId: 'node_a' } }), 'Tree');
  assert.equal(getRunSourceLabel({ metadata: { todoId: 'todo_a' } }), 'TODO');
  assert.equal(getRunSourceLabel({ metadata: {} }), 'Launcher');
});

test('buildContinuationChip prefers the run title and keeps the run id', () => {
  const chip = buildContinuationChip({
    id: 'run_ctx',
    metadata: {
      prompt: 'Investigate benchmark drift',
    },
  });

  assert.deepEqual(chip, {
    id: 'run_ctx',
    runId: 'run_ctx',
    label: 'Using run: Investigate benchmark drift',
  });
});

test('filterRunsForSelectedNode narrows to the active node but falls back when empty', () => {
  const runs = [
    {
      id: 'run_a',
      metadata: { treeNodeId: 'node_a' },
    },
    {
      id: 'run_b',
      attempt: { nodeId: 'node_b' },
    },
  ];

  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_a').map((item) => item.id), ['run_a']);
  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_b').map((item) => item.id), ['run_b']);
  assert.deepEqual(filterRunsForSelectedNode(runs, 'node_missing').map((item) => item.id), ['run_a', 'run_b']);
});

test('buildRecentRunReviewSummary groups active and attention states for activity headers', () => {
  const summary = buildRecentRunReviewSummary([
    { id: 'run_a', status: 'RUNNING', execution: { location: 'remote' }, resolvedTransport: 'daemon-task', metadata: { localSnapshot: { kind: 'workspace_patch' } }, observability: { sinkProviders: ['wandb'] } },
    { id: 'run_b', status: 'FAILED', execution: { location: 'remote' }, resolvedTransport: 'rust-daemon', observability: { sinkProviders: ['tensorboard'] } },
    { id: 'run_c', status: 'SUCCEEDED', contract: { ok: false }, metadata: { localSnapshot: { kind: 'workspace_patch' } } },
    { id: 'run_d', status: 'CANCELLED' },
  ]);

  assert.deepEqual(summary, {
    totalCount: 4,
    activeCount: 1,
    attentionCount: 3,
    completedCount: 1,
    failedCount: 1,
    cancelledCount: 1,
    contractFailureCount: 1,
    remoteExecutionCount: 2,
    snapshotBackedCount: 2,
    instrumentedCount: 2,
    instrumentedProviders: ['tensorboard', 'wandb'],
    resolvedTransports: ['daemon-task', 'rust-daemon'],
    status: 'needs_attention',
  });
});
