import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildArisControlTowerCard,
  buildArisProjectSummaryRow,
  buildArisReviewRow,
  buildArisWakeupRow,
  buildArisWorkItemRow,
} from './arisWorkspacePresentation.js';

test('buildArisProjectSummaryRow prefers urgent review load when present', () => {
  const row = buildArisProjectSummaryRow({
    id: 'proj_1',
    name: 'Dispatch Lab',
    workItemCount: 8,
    activeRunCount: 2,
    reviewReadyCount: 5,
    overdueWakeupCount: 1,
  });

  assert.equal(row.title, 'Dispatch Lab');
  assert.equal(row.reviewLabel, '5 review-ready');
  assert.equal(row.attentionLabel, '1 overdue wake-up');
});

test('buildArisControlTowerCard marks review-ready work as actionable', () => {
  const card = buildArisControlTowerCard({
    id: 'tower_2',
    kind: 'review',
    title: 'Review inbox',
    count: 4,
    status: 'review_ready',
    projectName: 'Dispatch Lab',
  });

  assert.equal(card.title, 'Review inbox');
  assert.equal(card.kindLabel, 'Review');
  assert.equal(card.statusLabel, 'Review ready');
  assert.equal(card.countLabel, '4');
  assert.equal(card.isUrgent, true);
});

test('buildArisWorkItemRow reflects blocked work items', () => {
  const row = buildArisWorkItemRow({
    id: 'wi_9',
    title: 'Unblock reviewer notes',
    status: 'blocked',
    type: 'decision',
    actorType: 'human',
    priority: 1,
    blockedReason: 'Waiting on collaborator feedback',
    nextCheckAt: '2026-03-20T18:00:00.000Z',
  });

  assert.equal(row.statusLabel, 'Blocked');
  assert.equal(row.blockedLabel, 'Waiting on collaborator feedback');
  assert.equal(row.actorLabel, 'Human');
});

test('buildArisWakeupRow tracks resolved wakeups distinctly', () => {
  const row = buildArisWakeupRow({
    id: 'wu_9',
    reason: 'Check CI',
    status: 'resolved',
    scheduledFor: '2026-03-20T09:00:00.000Z',
    firedAt: '2026-03-20T09:15:00.000Z',
  });

  assert.equal(row.statusLabel, 'Resolved');
  assert.equal(row.isOverdue, false);
  assert.equal(row.firedLabel, 'Fired 2026-03-20 09:15');
});

test('buildArisReviewRow labels accept decisions plainly', () => {
  const row = buildArisReviewRow({
    id: 'rev_9',
    title: 'Run review',
    decision: 'accept',
    reviewerName: 'czk',
    notes: 'Ship it',
  });

  assert.equal(row.decisionLabel, 'Accept');
  assert.equal(row.statusColor, 'accepted');
  assert.equal(row.reviewerLabel, 'Reviewer: czk');
  assert.equal(row.notes, 'Ship it');
});
