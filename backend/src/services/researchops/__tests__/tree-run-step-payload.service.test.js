'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTreeRunStepPayload } = require('../tree-run-step-payload.service');

test('buildTreeRunStepPayload adds attempt semantics for run mode results', () => {
  const payload = buildTreeRunStepPayload({
    projectId: 'proj_1',
    nodeId: 'baseline_root',
    result: {
      mode: 'run',
      run: {
        id: 'run_123',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        provider: 'codex',
        status: 'QUEUED',
        outputContract: {
          requiredArtifacts: ['metrics'],
          summaryRequired: true,
        },
        metadata: {
          treeNodeId: 'baseline_root',
          treeNodeTitle: 'Baseline Root',
          runSource: 'run-step',
          parentRunId: 'run_base',
          jobSpec: {
            backend: 'container',
            runtimeClass: 'container-fast',
          },
        },
      },
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'baseline_root');
  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'baseline_root');
  assert.equal(payload.execution.backend, 'container');
  assert.equal(payload.followUp.parentRunId, 'run_base');
  assert.equal(payload.contract.summaryRequired, true);
});

test('buildTreeRunStepPayload keeps non-run modes unchanged', () => {
  const payload = buildTreeRunStepPayload({
    projectId: 'proj_1',
    nodeId: 'node_search',
    result: {
      mode: 'search',
      search: {
        trials: [{ id: 'trial_1' }],
      },
    },
  });

  assert.equal(payload.mode, 'search');
  assert.equal(payload.nodeId, 'node_search');
  assert.equal('attempt' in payload, false);
});
