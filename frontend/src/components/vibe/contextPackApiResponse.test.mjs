import test from 'node:test';
import assert from 'node:assert/strict';

import { getContextPackViewForRun } from './contextPackApiResponse.js';

test('getContextPackViewForRun returns the matching view when pack.runId matches', () => {
  const view = getContextPackViewForRun({
    pack: { runId: 'run_123' },
    view: { runId: 'run_123', mode: 'routed' },
  }, 'run_123');

  assert.deepEqual(view, { runId: 'run_123', mode: 'routed' });
});

test('getContextPackViewForRun falls back to view.runId when pack.runId is absent', () => {
  const view = getContextPackViewForRun({
    pack: {},
    view: { runId: 'run_ctx', mode: 'legacy' },
  }, 'run_ctx');

  assert.deepEqual(view, { runId: 'run_ctx', mode: 'legacy' });
});

test('getContextPackViewForRun returns null for non-matching or invalid payloads', () => {
  assert.equal(getContextPackViewForRun(null, 'run_1'), null);
  assert.equal(getContextPackViewForRun({ pack: { runId: 'run_2' }, view: { runId: 'run_2' } }, 'run_1'), null);
});
