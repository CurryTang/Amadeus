'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDashboardPayload } = require('../dashboard-payload.service');

test('buildDashboardPayload preserves aggregate roots and exposes dashboard action', () => {
  const payload = buildDashboardPayload({
    projects: [{ id: 'proj_1', name: 'Project 1' }],
    ideas: [{ id: 'idea_1', title: 'Idea 1' }],
    queue: [{ id: 'run_queued_1', runId: 'run_queued_1' }],
    runs: [{ id: 'run_1', status: 'RUNNING' }, { id: 'run_2', status: 'FAILED' }],
    skills: [{ id: 'skill_1', name: 'skill-one' }],
    projectLimit: 80,
    itemLimit: 120,
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projects.length, 1);
  assert.equal(payload.projects[0].id, 'proj_1');
  assert.equal(payload.ideas.length, 1);
  assert.equal(payload.queue.length, 1);
  assert.equal(payload.runs.length, 2);
  assert.deepEqual(payload.reviewSummary, {
    totalCount: 2,
    activeCount: 1,
    attentionCount: 1,
    completedCount: 0,
    failedCount: 1,
    cancelledCount: 0,
    contractFailureCount: 0,
    status: 'needs_attention',
  });
  assert.equal(payload.skills.length, 1);
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.equal(payload.filters.projectLimit, 80);
  assert.equal(payload.filters.itemLimit, 120);
  assert.deepEqual(payload.actions.dashboard, {
    method: 'GET',
    path: '/researchops/dashboard',
  });
});
