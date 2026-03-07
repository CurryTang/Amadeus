'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildObservedSessionItemPayload,
  buildObservedSessionListPayload,
} = require('../observed-session-payload.service');

test('buildObservedSessionItemPayload normalizes detached-node and classification defaults', () => {
  const payload = buildObservedSessionItemPayload({
    projectId: 'proj_1',
    item: {
      id: 'obs_1',
      sessionId: 'sess_1',
      provider: 'codex',
      title: 'Observed task',
      status: 'running',
      detachedNodeId: 'observed_obs_1',
    },
    wrotePlan: true,
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.wrotePlan, true);
  assert.equal(payload.item.id, 'obs_1');
  assert.equal(payload.item.status, 'RUNNING');
  assert.equal(payload.item.hasDetachedNode, true);
  assert.equal(payload.item.materialization, 'none');
  assert.deepEqual(payload.item.classification, {
    decision: 'candidate',
    taskType: 'unknown',
    goalSummary: '',
    confidence: 0,
    reason: '',
    classifiedAt: payload.item.classification.classifiedAt,
  });
});

test('buildObservedSessionListPayload normalizes each item and keeps refreshedAt stable', () => {
  const payload = buildObservedSessionListPayload({
    projectId: 'proj_1',
    items: [
      {
        id: 'obs_1',
        sessionId: 'sess_1',
        provider: 'codex',
        title: 'Observed task',
        status: 'running',
        detachedNodeId: '',
      },
    ],
    wrotePlan: false,
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.wrotePlan, false);
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].hasDetachedNode, false);
  assert.equal(payload.items[0].materialization, 'none');
});

test('buildObservedSessionListPayload keeps cached source metadata when provided', () => {
  const payload = buildObservedSessionListPayload({
    items: [
      {
        id: 'obs_cached_1',
        status: 'idle',
      },
    ],
    cached: true,
  });

  assert.equal(payload.cached, true);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].status, 'IDLE');
});

test('buildObservedSessionListPayload exposes project-scoped actions when projectId is present', () => {
  const payload = buildObservedSessionListPayload({
    projectId: 'proj_1',
    items: [
      {
        id: 'obs_1',
        sessionId: 'sess_1',
        status: 'running',
      },
    ],
  });

  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/projects/proj_1/observed-sessions',
  });
  assert.deepEqual(payload.items[0].actions.detail, {
    method: 'GET',
    path: '/researchops/projects/proj_1/observed-sessions/obs_1',
  });
  assert.deepEqual(payload.items[0].actions.refresh, {
    method: 'POST',
    path: '/researchops/projects/proj_1/observed-sessions/obs_1/refresh',
  });
});
