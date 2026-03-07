import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTreeRunStepMessage } from './treeRunStepPresentation.js';

test('buildTreeRunStepMessage summarizes run mode with the created run id', () => {
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'run',
      nodeId: 'node_eval',
      run: { id: 'run_123' },
    }),
    'Started run run_123 for node_eval.'
  );
});

test('buildTreeRunStepMessage summarizes preflight and search modes', () => {
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'preflight',
      nodeId: 'node_eval',
      commands: ['python train.py', 'python eval.py'],
    }),
    'Preflight ready for node_eval with 2 commands.'
  );
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'search',
      nodeId: 'node_search',
      search: { trials: [{}, {}, {}] },
    }),
    'Queued search for node_search with 3 trials.'
  );
});

test('buildTreeRunStepMessage includes normalized preflight runtime and contract hints when available', () => {
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'preflight',
      nodeId: 'node_eval',
      commands: ['python train.py', 'python eval.py'],
      runPreview: {
        execution: {
          backend: 'container',
          runtimeClass: 'container-fast',
          runtimeProfile: {
            isolationTier: 'guarded',
          },
        },
        contract: {
          requiredArtifacts: ['metrics', 'table'],
        },
      },
    }),
    'Preflight ready for node_eval with 2 commands on container/container-fast (guarded isolation); 2 required artifacts.'
  );
});

test('buildTreeRunStepMessage includes snapshot-backed hints for preflight runs', () => {
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'preflight',
      nodeId: 'node_eval',
      commands: ['python train.py'],
      runPreview: {
        execution: {
          backend: 'container',
          runtimeClass: 'container-fast',
          runtimeProfile: {
            isolationTier: 'standard',
          },
        },
        workspaceSnapshot: {
          localSnapshot: {
            kind: 'git_diff',
          },
        },
      },
    }),
    'Preflight ready for node_eval with 1 command on container/container-fast (standard isolation); snapshot-backed.'
  );
});

test('buildTreeRunStepMessage includes runtime compatibility warnings when present', () => {
  assert.equal(
    buildTreeRunStepMessage({
      mode: 'preflight',
      nodeId: 'node_eval',
      commands: ['python train.py'],
      runPreview: {
        execution: {
          backend: 'local',
          runtimeClass: 'container-fast',
          runtimeProfile: {
            compatibilityWarning: 'Container Fast is not advertised for Local Host.',
          },
        },
      },
    }),
    'Preflight ready for node_eval with 1 command on local/container-fast; warning: Container Fast is not advertised for Local Host.'
  );
});
