const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const routePath = require.resolve('../aris');
const authPath = require.resolve('../../middleware/auth');
const servicePath = require.resolve('../../services/aris.service');

function loadRouterWithMocks(service) {
  const authModule = require(authPath);
  const serviceModule = require(servicePath);
  const originalAuth = authModule.requireAuth;
  const originalCreate = serviceModule.createArisService;

  authModule.requireAuth = (req, res, next) => {
    req.userId = 'tester';
    next();
  };
  serviceModule.createArisService = () => service;

  delete require.cache[routePath];
  const router = require(routePath);

  return {
    router,
    restore: () => {
      authModule.requireAuth = originalAuth;
      serviceModule.createArisService = originalCreate;
      delete require.cache[routePath];
    },
  };
}

async function createTestServer(router) {
  const app = express();
  app.use(express.json());
  app.use('/api/aris', router);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function requestJson(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return { response, body: parsed };
}

test('Dispatch routes surface control tower, project work items, and project now payloads', async () => {
  const calls = [];
  const service = {
    getControlTower: async (ctx) => {
      calls.push(['getControlTower', ctx]);
      return { overdueWakeups: 2, reviewReadyRuns: 3 };
    },
    listProjectWorkItems: async (projectId, ctx) => {
      calls.push(['listProjectWorkItems', projectId, ctx]);
      return [{ id: 'wi_1', title: 'Draft packet' }];
    },
    getProjectNow: async (projectId, ctx) => {
      calls.push(['getProjectNow', projectId, ctx]);
      return { projectId, northStar: 'Ship Dispatch' };
    },
  };

  const { router, restore } = loadRouterWithMocks(service);
  const server = await createTestServer(router);
  try {
    const controlTower = await requestJson(server.baseUrl, 'GET', '/api/aris/control-tower');
    assert.equal(controlTower.response.status, 200);
    assert.deepEqual(controlTower.body, { controlTower: { overdueWakeups: 2, reviewReadyRuns: 3 } });

    const workItems = await requestJson(server.baseUrl, 'GET', '/api/aris/projects/proj_1/work-items');
    assert.equal(workItems.response.status, 200);
    assert.deepEqual(workItems.body, { workItems: [{ id: 'wi_1', title: 'Draft packet' }] });

    const now = await requestJson(server.baseUrl, 'GET', '/api/aris/projects/proj_1/now');
    assert.equal(now.response.status, 200);
    assert.deepEqual(now.body, { now: { projectId: 'proj_1', northStar: 'Ship Dispatch' } });

    assert.deepEqual(calls, [
      ['getControlTower', { username: 'tester' }],
      ['listProjectWorkItems', 'proj_1', { username: 'tester' }],
      ['getProjectNow', 'proj_1', { username: 'tester' }],
    ]);
  } finally {
    await server.close();
    restore();
  }
});

test('Dispatch routes create work items, runs, wakeups, and reviews with the expected response envelopes', async () => {
  const calls = [];
  const service = {
    createWorkItem: async (projectId, payload, ctx) => {
      calls.push(['createWorkItem', projectId, payload, ctx]);
      return { id: 'wi_1', projectId, title: payload.title };
    },
    getWorkItem: async (workItemId, ctx) => {
      calls.push(['getWorkItem', workItemId, ctx]);
      return { id: workItemId, title: 'Packet' };
    },
    updateWorkItem: async (workItemId, payload, ctx) => {
      calls.push(['updateWorkItem', workItemId, payload, ctx]);
      return { id: workItemId, status: payload.status };
    },
    createWorkItemRun: async (workItemId, payload, ctx) => {
      calls.push(['createWorkItemRun', workItemId, payload, ctx]);
      return { id: 'run_1', workItemId, wakeupId: payload.wakeupId };
    },
    createRunWakeup: async (runId, payload, ctx) => {
      calls.push(['createRunWakeup', runId, payload, ctx]);
      return { id: 'wake_1', runId, scheduledFor: payload.scheduledFor };
    },
    listReviewInbox: async (ctx) => {
      calls.push(['listReviewInbox', ctx]);
      return [{ runId: 'run_1', priority: 10 }];
    },
    createReview: async (runId, payload, ctx) => {
      calls.push(['createReview', runId, payload, ctx]);
      return { id: 'review_1', runId, decision: payload.decision };
    },
  };

  const { router, restore } = loadRouterWithMocks(service);
  const server = await createTestServer(router);
  try {
    const created = await requestJson(server.baseUrl, 'POST', '/api/aris/projects/proj_1/work-items', {
      title: 'Draft packet',
      status: 'ready',
    });
    assert.equal(created.response.status, 201);
    assert.deepEqual(created.body, { workItem: { id: 'wi_1', projectId: 'proj_1', title: 'Draft packet' } });

    const fetched = await requestJson(server.baseUrl, 'GET', '/api/aris/work-items/wi_1');
    assert.equal(fetched.response.status, 200);
    assert.deepEqual(fetched.body, { workItem: { id: 'wi_1', title: 'Packet' } });

    const updated = await requestJson(server.baseUrl, 'PATCH', '/api/aris/work-items/wi_1', {
      status: 'in_progress',
    });
    assert.equal(updated.response.status, 200);
    assert.deepEqual(updated.body, { workItem: { id: 'wi_1', status: 'in_progress' } });

    const run = await requestJson(server.baseUrl, 'POST', '/api/aris/work-items/wi_1/runs', {
      actorKind: 'human',
      wakeupId: 'wake_1',
    });
    assert.equal(run.response.status, 201);
    assert.deepEqual(run.body, { run: { id: 'run_1', workItemId: 'wi_1', wakeupId: 'wake_1' } });

    const wakeup = await requestJson(server.baseUrl, 'POST', '/api/aris/runs/run_1/wakeups', {
      scheduledFor: '2026-03-20T15:00:00.000Z',
    });
    assert.equal(wakeup.response.status, 201);
    assert.deepEqual(wakeup.body, {
      wakeup: { id: 'wake_1', runId: 'run_1', scheduledFor: '2026-03-20T15:00:00.000Z' },
    });

    const reviewInbox = await requestJson(server.baseUrl, 'GET', '/api/aris/review-inbox');
    assert.equal(reviewInbox.response.status, 200);
    assert.deepEqual(reviewInbox.body, { reviewInbox: [{ runId: 'run_1', priority: 10 }] });

    const review = await requestJson(server.baseUrl, 'POST', '/api/aris/runs/run_1/reviews', {
      decision: 'accept',
    });
    assert.equal(review.response.status, 201);
    assert.deepEqual(review.body, { review: { id: 'review_1', runId: 'run_1', decision: 'accept' } });

    assert.deepEqual(calls, [
      ['createWorkItem', 'proj_1', { title: 'Draft packet', status: 'ready' }, { username: 'tester' }],
      ['getWorkItem', 'wi_1', { username: 'tester' }],
      ['updateWorkItem', 'wi_1', { status: 'in_progress' }, { username: 'tester' }],
      ['createWorkItemRun', 'wi_1', { actorKind: 'human', wakeupId: 'wake_1' }, { username: 'tester' }],
      ['createRunWakeup', 'run_1', { scheduledFor: '2026-03-20T15:00:00.000Z' }, { username: 'tester' }],
      ['listReviewInbox', { username: 'tester' }],
      ['createReview', 'run_1', { decision: 'accept' }, { username: 'tester' }],
    ]);
  } finally {
    await server.close();
    restore();
  }
});

test('Dispatch routes map validation failures to 400 and missing entities to 404', async () => {
  const service = {
    createWorkItem: async () => {
      throw new Error('title is required');
    },
    getWorkItem: async () => null,
    createWorkItemRun: async () => {
      throw new Error('wake-up is required');
    },
  };

  const { router, restore } = loadRouterWithMocks(service);
  const server = await createTestServer(router);
  try {
    const validation = await requestJson(server.baseUrl, 'POST', '/api/aris/projects/proj_1/work-items', {});
    assert.equal(validation.response.status, 400);
    assert.match(validation.body.error, /title is required/i);

    const missing = await requestJson(server.baseUrl, 'GET', '/api/aris/work-items/missing');
    assert.equal(missing.response.status, 404);
    assert.match(missing.body.error, /not found/i);

    const wakeupValidation = await requestJson(server.baseUrl, 'POST', '/api/aris/work-items/wi_1/runs', {});
    assert.equal(wakeupValidation.response.status, 400);
    assert.match(wakeupValidation.body.error, /wake-up is required/i);
  } finally {
    await server.close();
    restore();
  }
});
