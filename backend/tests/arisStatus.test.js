const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── Re-implement the unexported pure functions for direct unit testing ─────
// These mirror the logic in aris.service.js exactly.

function normalizeDispatchRunStatus(run = {}) {
  const status = String(run.status || 'draft').trim();
  if (status === 'running') return 'in_flight';
  if (status === 'completed') return 'review_ready';
  if (status === 'failed') return 'blocked';
  if (status === 'canceled') return 'canceled';
  if (status === 'queued') return 'queued';
  if (status === 'draft') return 'draft';
  return status;
}

function deriveWorkItemStatus(workItem = {}, runs = [], wakeups = [], reviews = []) {
  const stored = String(workItem.status || 'backlog').trim();
  if (['parked', 'done', 'canceled'].includes(stored)) return stored;
  if (reviews.length > 0) {
    const latest = reviews[0];
    if (latest?.decision === 'accept') return 'done';
    if (latest?.decision === 'park') return 'parked';
    if (latest?.decision === 'reject' || latest?.decision === 'escalate') return 'blocked';
    return 'review';
  }
  if (runs.some((run) => normalizeDispatchRunStatus(run) === 'review_ready')) return 'review';
  if (runs.some((run) => normalizeDispatchRunStatus(run) === 'blocked')) return 'blocked';
  if (runs.some((run) => ['in_flight', 'queued'].includes(normalizeDispatchRunStatus(run)))) return 'in_progress';
  if (wakeups.some((wakeup) => String(wakeup.status || '') === 'scheduled')) return 'waiting';
  if (stored === 'review') return 'review';
  if (stored === 'waiting') return 'waiting';
  if (stored === 'in_progress') return 'in_progress';
  const DISPATCH_WORK_ITEM_STATES = ['backlog', 'ready', 'in_progress', 'waiting', 'review', 'blocked', 'parked', 'done', 'canceled'];
  if (DISPATCH_WORK_ITEM_STATES.includes(stored)) return stored;
  return 'backlog';
}

function sortByUrgency(a = {}, b = {}) {
  const aScore = Number(a._urgencyScore || 0);
  const bScore = Number(b._urgencyScore || 0);
  if (aScore !== bScore) return bScore - aScore;
  const aTime = Date.parse(a.scheduledFor || a.updatedAt || a.createdAt || 0) || 0;
  const bTime = Date.parse(b.scheduledFor || b.updatedAt || b.createdAt || 0) || 0;
  return aTime - bTime;
}

// ─── normalizeDispatchRunStatus ─────────────────────────────────────────────

describe('normalizeDispatchRunStatus', () => {
  it('maps "running" to "in_flight"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'running' }), 'in_flight');
  });

  it('maps "completed" to "review_ready"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'completed' }), 'review_ready');
  });

  it('maps "failed" to "blocked"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'failed' }), 'blocked');
  });

  it('maps "canceled" to "canceled"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'canceled' }), 'canceled');
  });

  it('maps "queued" to "queued"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'queued' }), 'queued');
  });

  it('maps "draft" to "draft"', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'draft' }), 'draft');
  });

  it('defaults to "draft" when status is missing', () => {
    assert.equal(normalizeDispatchRunStatus({}), 'draft');
    assert.equal(normalizeDispatchRunStatus(), 'draft');
  });

  it('handles whitespace in status', () => {
    assert.equal(normalizeDispatchRunStatus({ status: '  running  ' }), 'in_flight');
  });

  it('passes through unknown status unchanged', () => {
    assert.equal(normalizeDispatchRunStatus({ status: 'custom_status' }), 'custom_status');
  });

  it('handles null/undefined status', () => {
    assert.equal(normalizeDispatchRunStatus({ status: null }), 'draft');
    assert.equal(normalizeDispatchRunStatus({ status: undefined }), 'draft');
  });
});

// ─── deriveWorkItemStatus ───────────────────────────────────────────────────

describe('deriveWorkItemStatus', () => {
  // Terminal states are preserved regardless of runs/wakeups/reviews
  describe('terminal states', () => {
    it('preserves "done" status regardless of other data', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'done' },
        [{ status: 'running' }],
        [{ status: 'scheduled' }],
        [{ decision: 'reject' }],
      ), 'done');
    });

    it('preserves "canceled" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'canceled' }, [], [], []), 'canceled');
    });

    it('preserves "parked" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'parked' }, [], [], []), 'parked');
    });
  });

  // Review decisions
  describe('review-based derivation', () => {
    it('accept review → done', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'accept' }],
      ), 'done');
    });

    it('park review → parked', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'park' }],
      ), 'parked');
    });

    it('reject review → blocked', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'reject' }],
      ), 'blocked');
    });

    it('escalate review → blocked', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'escalate' }],
      ), 'blocked');
    });

    it('revise review → review', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'revise' }],
      ), 'review');
    });

    it('split review → review', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'split' }],
      ), 'review');
    });

    it('uses first review in list (latest)', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' }, [], [],
        [{ decision: 'accept' }, { decision: 'reject' }], // accept is first = latest
      ), 'done');
    });

    it('reviews take precedence over runs', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' },
        [{ status: 'running' }], // would normally be in_progress
        [],
        [{ decision: 'reject' }], // review overrides
      ), 'blocked');
    });
  });

  // Run-based derivation
  describe('run-based derivation', () => {
    it('completed run → review', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' },
        [{ status: 'completed' }],
        [], [],
      ), 'review');
    });

    it('failed run → blocked', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' },
        [{ status: 'failed' }],
        [], [],
      ), 'blocked');
    });

    it('running run → in_progress', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' },
        [{ status: 'running' }],
        [], [],
      ), 'in_progress');
    });

    it('queued run → in_progress', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' },
        [{ status: 'queued' }],
        [], [],
      ), 'in_progress');
    });

    it('review_ready takes precedence over in_flight', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' },
        [{ status: 'completed' }, { status: 'running' }],
        [], [],
      ), 'review');
    });

    it('blocked (failed) takes precedence over in_flight', () => {
      // No completed run here, so review_ready check fails.
      // failed → blocked is checked before running → in_progress.
      assert.equal(deriveWorkItemStatus(
        { status: 'in_progress' },
        [{ status: 'failed' }, { status: 'running' }],
        [], [],
      ), 'blocked');
    });

    it('priority order: review_ready > blocked > in_progress', () => {
      // All three types of runs
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' },
        [{ status: 'completed' }, { status: 'failed' }, { status: 'running' }],
        [], [],
      ), 'review'); // review_ready checked first
    });

    it('blocked checked before in_progress', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' },
        [{ status: 'failed' }, { status: 'running' }],
        [], [],
      ), 'blocked');
    });
  });

  // Wakeup-based derivation
  describe('wakeup-based derivation', () => {
    it('scheduled wakeup → waiting', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' }, [],
        [{ status: 'scheduled' }],
        [],
      ), 'waiting');
    });

    it('fired wakeup does not affect status', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' }, [],
        [{ status: 'fired' }],
        [],
      ), 'backlog');
    });

    it('runs take precedence over wakeups', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'backlog' },
        [{ status: 'running' }],
        [{ status: 'scheduled' }],
        [],
      ), 'in_progress'); // run overrides wakeup
    });
  });

  // Stored status fallback
  describe('stored status fallback', () => {
    it('falls back to stored "review" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'review' }, [], [], []), 'review');
    });

    it('falls back to stored "waiting" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'waiting' }, [], [], []), 'waiting');
    });

    it('falls back to stored "in_progress" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'in_progress' }, [], [], []), 'in_progress');
    });

    it('falls back to stored "backlog" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'backlog' }, [], [], []), 'backlog');
    });

    it('falls back to stored "ready" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'ready' }, [], [], []), 'ready');
    });

    it('falls back to stored "blocked" status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'blocked' }, [], [], []), 'blocked');
    });

    it('defaults to "backlog" for empty/missing status', () => {
      assert.equal(deriveWorkItemStatus({}, [], [], []), 'backlog');
      assert.equal(deriveWorkItemStatus({ status: '' }, [], [], []), 'backlog');
      assert.equal(deriveWorkItemStatus({ status: null }, [], [], []), 'backlog');
    });

    it('defaults to "backlog" for unknown status', () => {
      assert.equal(deriveWorkItemStatus({ status: 'unknown_state' }, [], [], []), 'backlog');
    });
  });

  // Complex scenarios
  describe('complex multi-signal scenarios', () => {
    it('item with mixed run states and no reviews uses highest-priority run signal', () => {
      const result = deriveWorkItemStatus(
        { status: 'ready' },
        [
          { status: 'completed' },  // → review_ready (highest priority)
          { status: 'running' },     // → in_flight
          { status: 'queued' },      // → queued
        ],
        [{ status: 'scheduled' }],   // wakeup (lower priority than runs)
        [],
      );
      assert.equal(result, 'review');
    });

    it('stored "done" cannot be overridden by any signal', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'done' },
        [{ status: 'failed' }],
        [{ status: 'scheduled' }],
        [{ decision: 'reject' }],
      ), 'done');
    });

    it('stored "parked" cannot be overridden by reviews', () => {
      assert.equal(deriveWorkItemStatus(
        { status: 'parked' },
        [],
        [],
        [{ decision: 'accept' }],
      ), 'parked');
    });
  });
});

// ─── sortByUrgency ──────────────────────────────────────────────────────────

describe('sortByUrgency', () => {
  it('sorts by _urgencyScore descending', () => {
    const items = [
      { _urgencyScore: 100 },
      { _urgencyScore: 500 },
      { _urgencyScore: 200 },
    ];
    items.sort(sortByUrgency);
    assert.equal(items[0]._urgencyScore, 500);
    assert.equal(items[1]._urgencyScore, 200);
    assert.equal(items[2]._urgencyScore, 100);
  });

  it('breaks ties by scheduledFor ascending (earlier first)', () => {
    const items = [
      { _urgencyScore: 100, scheduledFor: '2025-03-20T12:00:00Z' },
      { _urgencyScore: 100, scheduledFor: '2025-03-20T08:00:00Z' },
      { _urgencyScore: 100, scheduledFor: '2025-03-20T16:00:00Z' },
    ];
    items.sort(sortByUrgency);
    assert.equal(items[0].scheduledFor, '2025-03-20T08:00:00Z');
    assert.equal(items[1].scheduledFor, '2025-03-20T12:00:00Z');
    assert.equal(items[2].scheduledFor, '2025-03-20T16:00:00Z');
  });

  it('falls back to updatedAt when scheduledFor is missing', () => {
    const items = [
      { _urgencyScore: 0, updatedAt: '2025-03-20T12:00:00Z' },
      { _urgencyScore: 0, updatedAt: '2025-03-20T08:00:00Z' },
    ];
    items.sort(sortByUrgency);
    assert.equal(items[0].updatedAt, '2025-03-20T08:00:00Z');
  });

  it('falls back to createdAt when updatedAt is also missing', () => {
    const items = [
      { _urgencyScore: 0, createdAt: '2025-03-20T12:00:00Z' },
      { _urgencyScore: 0, createdAt: '2025-03-20T08:00:00Z' },
    ];
    items.sort(sortByUrgency);
    assert.equal(items[0].createdAt, '2025-03-20T08:00:00Z');
  });

  it('handles missing urgency scores (defaults to 0)', () => {
    const items = [
      { _urgencyScore: 100 },
      {},
      { _urgencyScore: 50 },
    ];
    items.sort(sortByUrgency);
    assert.equal(items[0]._urgencyScore, 100);
    assert.equal(items[1]._urgencyScore, 50);
    assert.equal(items[2]._urgencyScore, undefined);
  });

  it('handles empty input gracefully', () => {
    assert.doesNotThrow(() => sortByUrgency());
    assert.doesNotThrow(() => sortByUrgency({}, {}));
  });
});

// ─── Control Tower aggregation logic ────────────────────────────────────────
// Test the aggregation patterns without DB, using inline simulation.

describe('Control Tower aggregation logic', () => {
  function buildControlTower(projects, workItems, runs, wakeups, reviews) {
    const reviewedRunIds = new Set(reviews.map(r => String(r.runId)));
    const now = Date.now();

    const activeProjects = projects.map(project => {
      const pItems = workItems.filter(i => String(i.projectId) === String(project.id));
      const pRuns = runs.filter(r => String(r.projectId) === String(project.id));
      const pWakeups = wakeups.filter(w => String(w.projectId) === String(project.id));
      return {
        ...project,
        workItemCount: pItems.length,
        inFlightRunCount: pRuns.filter(r => normalizeDispatchRunStatus(r) === 'in_flight').length,
        reviewReadyRunCount: pRuns.filter(r => normalizeDispatchRunStatus(r) === 'review_ready' && !reviewedRunIds.has(String(r.id))).length,
        overdueWakeupCount: pWakeups.filter(w => w.status === 'scheduled' && Date.parse(w.scheduledFor) < now).length,
      };
    });

    const reviewReadyRuns = runs
      .filter(r => normalizeDispatchRunStatus(r) === 'review_ready' && !reviewedRunIds.has(String(r.id)));

    const overdueWakeups = wakeups
      .filter(w => w.status === 'scheduled' && Date.parse(w.scheduledFor) < now);

    const blockedWorkItems = workItems
      .filter(item => {
        const relatedRuns = runs.filter(r => String(r.workItemId) === String(item.id));
        const relatedWakeups = wakeups.filter(w => String(w.workItemId) === String(item.id));
        const relatedReviews = reviews.filter(r => String(r.workItemId) === String(item.id));
        return deriveWorkItemStatus(item, relatedRuns, relatedWakeups, relatedReviews) === 'blocked';
      });

    const staleRuns = runs
      .filter(r => ['in_flight', 'queued'].includes(normalizeDispatchRunStatus(r))
        && Date.parse(r.updatedAt || r.startedAt || 0) < now - (6 * 60 * 60 * 1000));

    return { projects: activeProjects, reviewReadyRuns, overdueWakeups, blockedWorkItems, staleRuns };
  }

  it('counts work items per project', () => {
    const tower = buildControlTower(
      [{ id: 'p1' }, { id: 'p2' }],
      [
        { id: 'w1', projectId: 'p1' },
        { id: 'w2', projectId: 'p1' },
        { id: 'w3', projectId: 'p2' },
      ],
      [], [], [],
    );
    assert.equal(tower.projects[0].workItemCount, 2);
    assert.equal(tower.projects[1].workItemCount, 1);
  });

  it('counts in-flight runs per project', () => {
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [],
      [
        { id: 'r1', projectId: 'p1', status: 'running' },
        { id: 'r2', projectId: 'p1', status: 'queued' },
        { id: 'r3', projectId: 'p1', status: 'completed' },
      ],
      [], [],
    );
    assert.equal(tower.projects[0].inFlightRunCount, 1); // only 'running' maps to in_flight
  });

  it('counts review-ready runs excluding already-reviewed', () => {
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [],
      [
        { id: 'r1', projectId: 'p1', status: 'completed' },
        { id: 'r2', projectId: 'p1', status: 'completed' },
      ],
      [],
      [{ runId: 'r1', workItemId: 'w1' }], // r1 already reviewed
    );
    assert.equal(tower.projects[0].reviewReadyRunCount, 1); // only r2
    assert.equal(tower.reviewReadyRuns.length, 1);
    assert.equal(tower.reviewReadyRuns[0].id, 'r2');
  });

  it('detects overdue wakeups', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [],
      [],
      [
        { projectId: 'p1', status: 'scheduled', scheduledFor: pastDate },
        { projectId: 'p1', status: 'scheduled', scheduledFor: futureDate },
        { projectId: 'p1', status: 'fired', scheduledFor: pastDate }, // fired = not overdue
      ],
      [],
    );
    assert.equal(tower.projects[0].overdueWakeupCount, 1);
    assert.equal(tower.overdueWakeups.length, 1);
  });

  it('identifies blocked work items via failed runs', () => {
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [{ id: 'w1', projectId: 'p1', status: 'in_progress' }],
      [{ id: 'r1', projectId: 'p1', workItemId: 'w1', status: 'failed' }],
      [], [],
    );
    assert.equal(tower.blockedWorkItems.length, 1);
    assert.equal(tower.blockedWorkItems[0].id, 'w1');
  });

  it('identifies blocked work items via reject review', () => {
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [{ id: 'w1', projectId: 'p1', status: 'in_progress' }],
      [],
      [],
      [{ runId: 'r1', workItemId: 'w1', decision: 'reject' }],
    );
    assert.equal(tower.blockedWorkItems.length, 1);
  });

  it('detects stale runs (>6 hours without update)', () => {
    const staleTime = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7 hours ago
    const recentTime = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [],
      [
        { id: 'r1', projectId: 'p1', status: 'running', updatedAt: staleTime },
        { id: 'r2', projectId: 'p1', status: 'running', updatedAt: recentTime },
        { id: 'r3', projectId: 'p1', status: 'queued', updatedAt: staleTime },
        { id: 'r4', projectId: 'p1', status: 'completed', updatedAt: staleTime }, // completed = not checked
      ],
      [], [],
    );
    assert.equal(tower.staleRuns.length, 2); // r1 (stale running) + r3 (stale queued)
  });

  it('empty data returns empty aggregations', () => {
    const tower = buildControlTower([], [], [], [], []);
    assert.equal(tower.projects.length, 0);
    assert.equal(tower.reviewReadyRuns.length, 0);
    assert.equal(tower.overdueWakeups.length, 0);
    assert.equal(tower.blockedWorkItems.length, 0);
    assert.equal(tower.staleRuns.length, 0);
  });

  it('multiple projects aggregate independently', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const tower = buildControlTower(
      [{ id: 'p1' }, { id: 'p2' }],
      [
        { id: 'w1', projectId: 'p1', status: 'in_progress' },
        { id: 'w2', projectId: 'p2', status: 'in_progress' },
      ],
      [
        { id: 'r1', projectId: 'p1', workItemId: 'w1', status: 'running' },
        { id: 'r2', projectId: 'p2', workItemId: 'w2', status: 'completed' },
      ],
      [
        { projectId: 'p1', status: 'scheduled', scheduledFor: pastDate },
      ],
      [],
    );
    // Project 1: 1 work item, 1 in-flight, 0 review-ready, 1 overdue wakeup
    assert.equal(tower.projects[0].workItemCount, 1);
    assert.equal(tower.projects[0].inFlightRunCount, 1);
    assert.equal(tower.projects[0].reviewReadyRunCount, 0);
    assert.equal(tower.projects[0].overdueWakeupCount, 1);

    // Project 2: 1 work item, 0 in-flight, 1 review-ready, 0 overdue wakeups
    assert.equal(tower.projects[1].workItemCount, 1);
    assert.equal(tower.projects[1].inFlightRunCount, 0);
    assert.equal(tower.projects[1].reviewReadyRunCount, 1);
    assert.equal(tower.projects[1].overdueWakeupCount, 0);
  });

  it('work item with accepted review + failed run is "done" (terminal)', () => {
    // The stored status is 'done' (set by review handler), so even with failed runs
    // it should stay done (terminal state check)
    const tower = buildControlTower(
      [{ id: 'p1' }],
      [{ id: 'w1', projectId: 'p1', status: 'done' }],
      [{ id: 'r1', projectId: 'p1', workItemId: 'w1', status: 'failed' }],
      [], [],
    );
    assert.equal(tower.blockedWorkItems.length, 0); // not blocked because stored status is 'done'
  });
});
