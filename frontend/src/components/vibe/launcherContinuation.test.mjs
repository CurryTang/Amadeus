import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addContinuationChip,
  buildPayloadWithContinuation,
} from './launcherContinuation.js';

test('addContinuationChip stores one visible chip for the selected run', () => {
  const chips = addContinuationChip([], {
    id: 'run_ctx',
    metadata: {
      prompt: 'Compare against baseline',
    },
  });

  assert.equal(chips.length, 1);
  assert.equal(chips[0].runId, 'run_ctx');
  assert.equal(chips[0].label, 'Using run: Compare against baseline');
});

test('buildPayloadWithContinuation adds run context without mutating prompt text', () => {
  const payload = buildPayloadWithContinuation({
    metadata: {
      prompt: 'Implement the follow-up fix',
    },
    contextRefs: {},
  }, [
    {
      runId: 'run_ctx',
      label: 'Using run: Compare against baseline',
    },
  ]);

  assert.equal(payload.metadata.prompt, 'Implement the follow-up fix');
  assert.equal(payload.metadata.parentRunId, 'run_ctx');
  assert.deepEqual(payload.contextRefs.continueRunIds, ['run_ctx']);
});
