import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildObservedSessionCards,
  getObservedSessionMaterializationLabel,
  getObservedSessionNodeLabel,
  getObservedSessionProviderLabel,
} from './observedSessionPresentation.js';

test('buildObservedSessionCards sorts most recently updated sessions first', () => {
  const cards = buildObservedSessionCards([
    {
      id: 'obs_old',
      provider: 'claude_code',
      title: 'Investigate search quality',
      latestProgressDigest: 'Collecting baseline metrics',
      updatedAt: '2026-03-05T10:00:00.000Z',
      status: 'SUCCEEDED',
      detachedNodeId: '',
    },
    {
      id: 'obs_new',
      provider: 'codex',
      title: 'Implement observed session sync',
      latestProgressDigest: 'Wiring the runner strip and detached nodes',
      updatedAt: '2026-03-05T11:00:00.000Z',
      status: 'RUNNING',
      detachedNodeId: 'observed_obs_new',
      detachedNodeTitle: 'Implement observed session sync',
      materialization: 'created',
    },
  ]);

  assert.equal(cards.length, 2);
  assert.equal(cards[0].id, 'obs_new');
  assert.equal(cards[0].providerLabel, 'Codex');
  assert.equal(cards[0].observedLabel, 'Observed');
  assert.equal(cards[0].nodeLabel, 'Node: Implement observed session sync');
  assert.equal(cards[0].materializationLabel, 'Detached node created');
  assert.equal(cards[1].id, 'obs_old');
  assert.equal(cards[1].providerLabel, 'Claude');
  assert.equal(cards[1].nodeLabel, 'Unlinked');
  assert.equal(cards[1].materializationLabel, 'Unlinked');
});

test('getObservedSessionProviderLabel normalizes provider names', () => {
  assert.equal(getObservedSessionProviderLabel({ provider: 'codex' }), 'Codex');
  assert.equal(getObservedSessionProviderLabel({ provider: 'claude_code' }), 'Claude');
  assert.equal(getObservedSessionProviderLabel({ provider: 'unknown' }), 'Agent');
});

test('getObservedSessionNodeLabel exposes detached-node state', () => {
  assert.equal(
    getObservedSessionNodeLabel({
      detachedNodeId: 'observed_obs_1',
      detachedNodeTitle: 'Investigate baseline runner',
    }),
    'Node: Investigate baseline runner'
  );
  assert.equal(getObservedSessionNodeLabel({ detachedNodeId: 'observed_obs_1' }), 'Node: observed_obs_1');
  assert.equal(getObservedSessionNodeLabel({ detachedNodeId: '' }), 'Unlinked');
});

test('getObservedSessionMaterializationLabel distinguishes created, updated, and linked nodes', () => {
  assert.equal(getObservedSessionMaterializationLabel({ detachedNodeId: '', materialization: 'none' }), 'Unlinked');
  assert.equal(getObservedSessionMaterializationLabel({ detachedNodeId: 'observed_obs_1', materialization: 'created' }), 'Detached node created');
  assert.equal(getObservedSessionMaterializationLabel({ detachedNodeId: 'observed_obs_1', materialization: 'updated' }), 'Detached node updated');
  assert.equal(getObservedSessionMaterializationLabel({ detachedNodeId: 'observed_obs_1', materialization: 'existing' }), 'Detached node linked');
});
