import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveAgentSessionAttemptLabel,
  getAgentSessionDetailFromApiResponse,
  getAgentSessionsFromApiResponse,
} from './agentSessionApiResponse.js';

test('getAgentSessionsFromApiResponse returns normalized session arrays', () => {
  const sessions = [{ id: 'sess_1', status: 'IDLE' }];
  const response = { sessions };

  assert.equal(getAgentSessionsFromApiResponse(response), sessions);
});

test('getAgentSessionDetailFromApiResponse keeps session, activeRun, and activeAttempt together', () => {
  const response = {
    session: { id: 'sess_1', status: 'RUNNING' },
    activeRun: { id: 'run_123', status: 'RUNNING' },
    activeAttempt: { id: 'run_123', treeNodeTitle: 'Baseline Root' },
  };

  assert.deepEqual(getAgentSessionDetailFromApiResponse(response), response);
});

test('getActiveAgentSessionAttemptLabel prefers tree node title over run id', () => {
  const detail = {
    activeRun: { id: 'run_123' },
    activeAttempt: { id: 'run_123', treeNodeTitle: 'Baseline Root' },
  };

  assert.equal(getActiveAgentSessionAttemptLabel(detail), 'Baseline Root');
});

test('getActiveAgentSessionAttemptLabel falls back to run id when no tree title exists', () => {
  const detail = {
    activeRun: { id: 'run_456' },
    activeAttempt: { id: 'run_456', treeNodeTitle: '' },
  };

  assert.equal(getActiveAgentSessionAttemptLabel(detail), 'run_456');
});
