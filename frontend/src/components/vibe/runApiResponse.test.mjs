import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRunFromApiResponse,
  getRunIdFromApiResponse,
} from './runApiResponse.js';

test('getRunFromApiResponse prefers the normalized run payload', () => {
  const run = { id: 'run_123', projectId: 'proj_1' };
  const response = {
    run,
    attempt: { id: 'run_123' },
  };

  assert.equal(getRunFromApiResponse(response), run);
  assert.equal(getRunIdFromApiResponse(response), 'run_123');
});

test('getRunFromApiResponse falls back to legacy nested payloads', () => {
  const run = { id: 'run_legacy', projectId: 'proj_1' };
  const response = {
    data: {
      run,
    },
  };

  assert.equal(getRunFromApiResponse(response), run);
  assert.equal(getRunIdFromApiResponse(response), 'run_legacy');
});

test('getRunIdFromApiResponse falls back to attempt id when run is absent', () => {
  const response = {
    attempt: {
      id: 'run_attempt_only',
    },
  };

  assert.equal(getRunFromApiResponse(response), null);
  assert.equal(getRunIdFromApiResponse(response), 'run_attempt_only');
});
