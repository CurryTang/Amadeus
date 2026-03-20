const test = require('node:test');
const assert = require('node:assert/strict');

const { createArisService } = require('../aris.service');

function createBaseService(overrides = {}) {
  return createArisService({
    listProjects: async () => ([{
      id: 'proj_1',
      name: 'Dispatch Project',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'dispatch-project',
      syncExcludes: ['local/'],
    }]),
    getProjectById: async (projectId) => ({
      id: projectId,
      name: 'Dispatch Project',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'dispatch-project',
      syncExcludes: ['local/'],
    }),
    listLaunches: async () => overrides.listLaunches?.() || [],
    getLaunchById: async (runId) => overrides.getLaunchById?.(runId) || null,
    saveLaunch: async (launch) => overrides.saveLaunch?.(launch),
    listTargets: async () => ([]),
    listServers: async () => ([{
      id: 1,
      name: 'wsl-main',
      host: '127.0.0.1',
      user: 'czk',
      status: 'configured',
    }]),
    saveWorkItem: async (workItem) => overrides.saveWorkItem?.(workItem),
    getWorkItemById: async (workItemId) => overrides.getWorkItemById?.(workItemId) || null,
    listWorkItems: async (projectId) => overrides.listWorkItems?.(projectId) || [],
    saveMilestone: async (milestone) => overrides.saveMilestone?.(milestone),
    listMilestones: async (projectId) => overrides.listMilestones?.(projectId) || [],
    saveWakeup: async (wakeup) => overrides.saveWakeup?.(wakeup),
    listWakeups: async (filters) => overrides.listWakeups?.(filters) || [],
    saveReview: async (review) => overrides.saveReview?.(review),
    listReviews: async (filters) => overrides.listReviews?.(filters) || [],
    saveDecision: async (decision) => overrides.saveDecision?.(decision),
    listDecisions: async (filters) => overrides.listDecisions?.(filters) || [],
  });
}

test('createWorkItem stores a structured dispatch packet with a backlog default', async () => {
  const saved = [];
  const service = createBaseService({
    saveWorkItem: async (workItem) => {
      saved.push(workItem);
    },
  });

  const workItem = await service.createWorkItem('proj_1', {
    title: 'Review agent output',
    summary: 'Review the first Codex pass',
    type: 'decision',
    priority: 3,
    goal: 'Decide whether the run is ready',
    whyItMatters: 'Prevents wasted cycles',
    contextMd: 'Context',
    constraintsMd: 'Constraints',
    deliverableMd: 'Deliverable',
    verificationMd: 'Verification',
    blockedBehaviorMd: 'Blocked behavior',
    outputFormatMd: 'Markdown',
    nextBestAction: 'Inspect output',
    dueAt: '2026-03-20T18:00:00.000Z',
  });

  assert.equal(workItem.projectId, 'proj_1');
  assert.equal(workItem.status, 'backlog');
  assert.equal(workItem.title, 'Review agent output');
  assert.equal(workItem.priority, 3);
  assert.equal(saved.length, 1);
});

test('createWorkItemRun requires a wake-up before a run can be created', async () => {
  const service = createBaseService({
    getWorkItemById: async () => ({
      id: 'work_1',
      projectId: 'proj_1',
      title: 'Review agent output',
      status: 'ready',
    }),
  });

  await assert.rejects(
    service.createWorkItemRun('work_1', {
      title: 'Dispatch Codex pass',
      prompt: 'Make the change',
    }),
    /wake-up/i
  );
});

test('createWorkItemRun persists a queued run and wake-up together', async () => {
  const savedRuns = [];
  const savedWakeups = [];
  const service = createBaseService({
    getWorkItemById: async () => ({
      id: 'work_1',
      projectId: 'proj_1',
      title: 'Review agent output',
      status: 'ready',
    }),
    saveLaunch: async (launch) => {
      savedRuns.push(launch);
    },
    saveWakeup: async (wakeup) => {
      savedWakeups.push(wakeup);
    },
  });

  const run = await service.createWorkItemRun('work_1', {
    title: 'Dispatch Codex pass',
    prompt: 'Make the change',
    actorKind: 'codex',
    wakeup: {
      scheduledFor: '2026-03-20T18:30:00.000Z',
      reason: 'Check the generated patch',
    },
  }, { username: 'czk' });

  assert.equal(run.workItemId, 'work_1');
  assert.equal(run.status, 'queued');
  assert.equal(savedRuns.length, 1);
  assert.equal(savedWakeups.length, 1);
  assert.equal(savedWakeups[0].runId, run.id);
});

test('control tower aggregates overdue wake-ups and review-ready runs', async () => {
  const service = createBaseService({
    listWorkItems: async () => ([
      { id: 'work_1', projectId: 'proj_1', title: 'Review agent output', status: 'ready', priority: 3 },
    ]),
    listLaunches: async () => ([
      { id: 'run_1', projectId: 'proj_1', workItemId: 'work_1', status: 'completed', startedAt: '2026-03-20T10:00:00.000Z', updatedAt: '2026-03-20T11:00:00.000Z' },
      { id: 'run_2', projectId: 'proj_1', workItemId: 'work_1', status: 'running', startedAt: '2026-03-20T12:00:00.000Z', updatedAt: '2026-03-20T12:15:00.000Z' },
    ]),
    listWakeups: async () => ([
      { id: 'wake_1', workItemId: 'work_1', runId: 'run_1', scheduledFor: '2026-03-20T09:00:00.000Z', firedAt: null, status: 'scheduled', reason: 'Review pending output' },
    ]),
    listProjects: async () => ([{ id: 'proj_1', name: 'Dispatch Project', priority: 5 }]),
  });

  const tower = await service.getControlTower();

  assert.equal(tower.overdueWakeups.length, 1);
  assert.equal(tower.reviewReadyRuns.length, 1);
  assert.equal(tower.projects.length, 1);
  assert.equal(tower.reviewReadyRuns[0].dispatchStatus, 'review_ready');
});

test('createReview updates the linked work item for accept and revise decisions', async () => {
  const savedReviews = [];
  const savedWorkItems = [];
  const service = createBaseService({
    getLaunchById: async () => ({
      id: 'run_1',
      projectId: 'proj_1',
      workItemId: 'work_1',
      status: 'completed',
      projectName: 'Dispatch Project',
    }),
    getWorkItemById: async () => ({
      id: 'work_1',
      projectId: 'proj_1',
      title: 'Review agent output',
      status: 'review',
    }),
    saveReview: async (review) => {
      savedReviews.push(review);
    },
    saveWorkItem: async (workItem) => {
      savedWorkItems.push(workItem);
    },
  });

  const review = await service.createReview('run_1', {
    decision: 'accept',
    notesMd: 'Looks good',
  }, { username: 'czk' });

  assert.equal(review.decision, 'accept');
  assert.equal(savedReviews.length, 1);
  assert.equal(savedWorkItems.length, 1);
  assert.equal(savedWorkItems[0].status, 'done');
});
