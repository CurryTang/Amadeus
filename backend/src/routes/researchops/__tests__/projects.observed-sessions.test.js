'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('listObservedSessionsForProject returns project-scoped observed sessions', async () => {
  const result = await projectsRouter.listObservedSessionsForProject({
    userId: 'czk',
    projectId: 'proj_1',
    resolveProjectContextFn: async () => ({
      project: {
        id: 'proj_1',
        projectPath: '/repo',
      },
      server: null,
    }),
    observedSessionService: {
      syncProjectObservedSessions: async () => ({
        items: [
          {
            id: 'obs_1',
            provider: 'codex',
            title: 'Implement observed session sync',
            detachedNodeId: 'observed_obs_1',
          },
        ],
        wrotePlan: true,
      }),
    },
  });

  assert.equal(result.projectId, 'proj_1');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].provider, 'codex');
  assert.equal(result.items[0].detachedNodeId, 'observed_obs_1');
  assert.equal(result.wrotePlan, true);
});

test('getObservedSessionForProject returns a matching observed session by id', async () => {
  const result = await projectsRouter.getObservedSessionForProject({
    userId: 'czk',
    projectId: 'proj_1',
    sessionId: 'obs_2',
    resolveProjectContextFn: async () => ({
      project: {
        id: 'proj_1',
        projectPath: '/repo',
      },
      server: null,
    }),
    observedSessionService: {
      syncProjectObservedSessions: async () => ({
        items: [
          { id: 'obs_1', title: 'Ignored' },
          { id: 'obs_2', title: 'Implement observed session detail route' },
        ],
        wrotePlan: false,
      }),
    },
  });

  assert.equal(result.projectId, 'proj_1');
  assert.equal(result.item.id, 'obs_2');
  assert.equal(result.item.title, 'Implement observed session detail route');
});

test('refreshObservedSessionForProject returns hash/classification/node information', async () => {
  const result = await projectsRouter.refreshObservedSessionForProject({
    userId: 'czk',
    projectId: 'proj_1',
    sessionId: 'obs_3',
    resolveProjectContextFn: async () => ({
      project: {
        id: 'proj_1',
        projectPath: '/repo',
      },
      server: null,
    }),
    observedSessionService: {
      refreshProjectObservedSession: async () => ({
        item: {
          id: 'obs_3',
          contentHash: 'abc123',
          classification: {
            decision: 'can_be_node',
            goalSummary: 'Implement observed session refresh flow',
          },
          detachedNodeId: 'observed_obs_3',
          materialization: 'created',
        },
        wrotePlan: true,
      }),
    },
  });

  assert.equal(result.projectId, 'proj_1');
  assert.equal(result.item.id, 'obs_3');
  assert.equal(result.item.contentHash, 'abc123');
  assert.equal(result.item.classification.decision, 'can_be_node');
  assert.equal(result.item.detachedNodeId, 'observed_obs_3');
  assert.equal(result.item.materialization, 'created');
  assert.equal(result.wrotePlan, true);
});
