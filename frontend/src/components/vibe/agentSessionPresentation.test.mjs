import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAgentSessionHeaderSummary,
  buildAgentSessionListItem,
} from './agentSessionPresentation.js';

test('buildAgentSessionListItem returns running state for active sessions', () => {
  const result = buildAgentSessionListItem({
    id: 'sess_1',
    title: 'Investigate failure',
    status: 'RUNNING',
    updatedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(result.title, 'Investigate failure');
  assert.equal(result.statusTone, 'running');
  assert.equal(result.statusLabel, 'Running');
});

test('buildAgentSessionHeaderSummary prefers active run status and attempt label', () => {
  const result = buildAgentSessionHeaderSummary({
    session: { id: 'sess_1', title: 'Investigate failure', status: 'RUNNING' },
    activeRun: { id: 'run_123', status: 'PROVISIONING' },
    activeAttemptLabel: 'Baseline Root',
  });

  assert.equal(result.title, 'Investigate failure');
  assert.equal(result.statusTone, 'provisioning');
  assert.equal(result.statusLabel, 'Running (PROVISIONING)');
  assert.equal(result.runLabel, 'run_123');
  assert.equal(result.attemptLabel, 'Baseline Root');
});

test('buildAgentSessionHeaderSummary falls back to idle session state', () => {
  const result = buildAgentSessionHeaderSummary({
    session: { id: 'sess_2', status: 'IDLE' },
    activeRun: null,
    activeAttemptLabel: '',
  });

  assert.equal(result.title, 'sess_2');
  assert.equal(result.statusTone, 'idle');
  assert.equal(result.statusLabel, 'IDLE');
  assert.equal(result.runLabel, '');
  assert.equal(result.attemptLabel, '');
});
