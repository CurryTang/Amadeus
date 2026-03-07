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
        },
        contract: {
          requiredArtifacts: ['metrics', 'table'],
        },
      },
    }),
    'Preflight ready for node_eval with 2 commands on container/container-fast; 2 required artifacts.'
  );
});
