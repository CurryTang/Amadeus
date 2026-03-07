'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunListPayload } = require('../run-list-payload.service');

test('buildRunListPayload keeps list pagination while exposing attempt-shaped items', () => {
  const run = {
    id: 'run_123',
    projectId: 'proj_1',
    serverId: 'local-default',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'SUCCEEDED',
    metadata: {
      treeNodeId: 'baseline_root',
      treeNodeTitle: 'Baseline Root',
      runSource: 'run-step',
      resultSnippet: 'Patched benchmark harness',
    },
  };

  const payload = buildRunListPayload({
    page: {
      items: [run],
      hasMore: true,
      nextCursor: 'cursor_2',
    },
    limit: 20,
    cursor: 'cursor_1',
  });

  assert.equal(payload.limit, 20);
  assert.equal(payload.cursor, 'cursor_1');
  assert.equal(payload.hasMore, true);
  assert.equal(payload.nextCursor, 'cursor_2');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].run, undefined);
  assert.equal(payload.items[0].id, 'run_123');
  assert.equal(payload.items[0].attempt.id, 'run_123');
  assert.equal(payload.items[0].attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.items[0].execution.serverId, 'local-default');
  assert.equal(payload.items[0].execution.location, 'local');
  assert.equal(payload.items[0].resultSnippet, 'Patched benchmark harness');
});

test('buildRunListPayload includes follow-up semantics on list items', () => {
  const payload = buildRunListPayload({
    page: {
      items: [{
        id: 'run_child',
        projectId: 'proj_1',
        serverId: 'local-default',
        provider: 'codex',
        runType: 'AGENT',
        status: 'SUCCEEDED',
        contextRefs: {
          continueRunIds: ['run_parent', 'run_compare'],
        },
        metadata: {
          parentRunId: 'run_parent',
          continuationPhase: 'branch',
          branchLabel: 'best-seed',
        },
      }],
      hasMore: false,
    },
    limit: 20,
  });

  assert.deepEqual(payload.items[0].followUp, {
    parentRunId: 'run_parent',
    continuationOfRunId: null,
    continuationPhase: 'branch',
    branchLabel: 'best-seed',
    relatedRunIds: ['run_parent', 'run_compare'],
    isContinuation: true,
  });
});

test('buildRunListPayload includes normalized output contract semantics on list items', () => {
  const payload = buildRunListPayload({
    page: {
      items: [{
        id: 'run_contract',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        provider: 'codex',
        runType: 'AGENT',
        status: 'SUCCEEDED',
        outputContract: {
          requiredArtifacts: ['metrics', 'table'],
          metricKeys: ['accuracy'],
          summaryRequired: true,
        },
      }],
      hasMore: false,
    },
    limit: 20,
  });

  assert.deepEqual(payload.items[0].contract, {
    requiredArtifacts: ['metrics', 'table'],
    tables: [],
    figures: [],
    metricKeys: ['accuracy'],
    summaryRequired: true,
    ok: null,
    missingTables: [],
    missingFigures: [],
  });
});

test('buildRunListPayload includes normalized workspace and env snapshot semantics on list items', () => {
  const payload = buildRunListPayload({
    page: {
      items: [{
        id: 'run_snapshot',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        provider: 'codex',
        runType: 'AGENT',
        status: 'SUCCEEDED',
        metadata: {
          cwdSourceServerId: 'srv_sync_1',
          workspaceSnapshot: {
            path: '/tmp/list-workspace',
            runSpecArtifactId: 'artifact_list_spec',
          },
          localSnapshot: {
            kind: 'tarball',
          },
          jobSpec: {
            backend: 'container',
            runtimeClass: 'container-fast',
            resources: {
              cpu: 4,
              timeoutMin: 15,
            },
          },
        },
      }],
      hasMore: false,
    },
    limit: 20,
  });

  assert.deepEqual(payload.items[0].workspaceSnapshot, {
    path: '/tmp/list-workspace',
    sourceServerId: 'srv_sync_1',
    runSpecArtifactId: 'artifact_list_spec',
    localSnapshot: {
      kind: 'tarball',
    },
  });
  assert.deepEqual(payload.items[0].envSnapshot, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 4,
      gpu: null,
      ramGb: null,
      timeoutMin: 15,
    },
  });
});
