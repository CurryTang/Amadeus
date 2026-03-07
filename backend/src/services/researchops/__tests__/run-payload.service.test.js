'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunPayload } = require('../run-payload.service');

test('buildRunPayload keeps the run while exposing attempt semantics', () => {
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
    },
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.run, run);
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.attempt.status, 'SUCCEEDED');
  assert.equal(payload.execution.serverId, 'local-default');
  assert.equal(payload.execution.location, 'local');
  assert.equal(payload.execution.backend, 'local');
  assert.equal('bundle' in payload, false);
});

test('buildRunPayload exposes explicit execution contract fields when metadata carries job spec details', () => {
  const run = {
    id: 'run_exec',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    mode: 'headless',
    status: 'QUEUED',
    metadata: {
      jobSpec: {
        backend: 'container',
        runtimeClass: 'container-fast',
        resources: {
          cpu: 4,
          gpu: 1,
          ramGb: 24,
          timeoutMin: 30,
        },
      },
    },
  };

  const payload = buildRunPayload({ run });

  assert.equal(payload.execution.serverId, 'srv_remote_1');
  assert.equal(payload.execution.location, 'remote');
  assert.equal(payload.execution.mode, 'headless');
  assert.equal(payload.execution.backend, 'container');
  assert.equal(payload.execution.runtimeClass, 'container-fast');
  assert.deepEqual(payload.execution.resources, {
    cpu: 4,
    gpu: 1,
    ramGb: 24,
    timeoutMin: 30,
  });
});

test('buildRunPayload exposes follow-up semantics for continuation and compare-linked runs', () => {
  const run = {
    id: 'run_followup',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'AGENT',
    status: 'SUCCEEDED',
    contextRefs: {
      continueRunIds: ['run_base', 'run_alt'],
    },
    metadata: {
      parentRunId: 'run_base',
      continuationOfRunId: 'run_base',
      continuationPhase: 'analysis',
      branchLabel: 'ablation-b',
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.followUp, {
    parentRunId: 'run_base',
    continuationOfRunId: 'run_base',
    continuationPhase: 'analysis',
    branchLabel: 'ablation-b',
    relatedRunIds: ['run_base', 'run_alt'],
    isContinuation: true,
  });
});

test('buildRunPayload exposes normalized output contract semantics', () => {
  const run = {
    id: 'run_contract',
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    provider: 'codex',
    runType: 'EXPERIMENT',
    status: 'QUEUED',
    outputContract: {
      requiredArtifacts: ['metrics', 'table', 'figure'],
      tables: ['accuracy_summary'],
      figures: ['loss_curve'],
      metricKeys: ['accuracy', 'loss'],
      summaryRequired: true,
    },
  };

  const payload = buildRunPayload({ run });

  assert.deepEqual(payload.contract, {
    requiredArtifacts: ['metrics', 'table', 'figure'],
    tables: ['accuracy_summary'],
    figures: ['loss_curve'],
    metricKeys: ['accuracy', 'loss'],
    summaryRequired: true,
    ok: null,
    missingTables: [],
    missingFigures: [],
  });
});
