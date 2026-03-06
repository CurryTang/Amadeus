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

test('listObservedSessionsForProject uses the SSH observer proxy for ssh projects', async () => {
  const calls = [];
  const result = await projectsRouter.listObservedSessionsForProject({
    userId: 'czk',
    projectId: 'proj_ssh',
    resolveProjectContextFn: async () => ({
      project: {
        id: 'proj_ssh',
        projectPath: '/repo',
        locationType: 'ssh',
      },
      server: { id: 'srv_1', host: 'example.com', user: 'alice', port: 22 },
    }),
    sshObservedSessionProxy: {
      listObservedSessionsViaSshObserver: async (input) => {
        calls.push(input);
        return {
          items: [
            {
              id: 'obs_ssh_1',
              sessionId: 'sess_ssh_1',
              provider: 'codex',
              sessionFile: '/home/alice/.codex/sessions/rollout.jsonl',
              gitRoot: '/repo',
              cwd: '/repo',
              title: 'Remote observer task',
              promptDigest: 'Remote observer task',
              latestProgressDigest: 'Reading remote files',
              status: 'RUNNING',
              updatedAt: '2026-03-06T10:02:00.000Z',
              contentHash: 'remote123',
            },
          ],
        };
      },
    },
    observedSessionService: {
      syncProjectObservedSessions: async ({ sessions }) => ({
        items: sessions,
        wrotePlan: false,
      }),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].gitRoot, '/repo');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sessionId, 'sess_ssh_1');
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
          detachedNodeTitle: 'Implement observed session refresh flow',
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
  assert.equal(result.item.detachedNodeTitle, 'Implement observed session refresh flow');
  assert.equal(result.item.materialization, 'created');
  assert.equal(result.wrotePlan, true);
});

test('refreshObservedSessionForProject uses the SSH observer proxy for ssh projects', async () => {
  const calls = [];
  const result = await projectsRouter.refreshObservedSessionForProject({
    userId: 'czk',
    projectId: 'proj_ssh',
    sessionId: 'sess_ssh_2',
    resolveProjectContextFn: async () => ({
      project: {
        id: 'proj_ssh',
        projectPath: '/repo',
        locationType: 'ssh',
      },
      server: { id: 'srv_1', host: 'example.com', user: 'alice', port: 22 },
    }),
    sshObservedSessionProxy: {
      getObservedSessionViaSshObserver: async (input) => {
        calls.push(input);
        return {
          item: {
            id: 'obs_ssh_2',
            sessionId: 'sess_ssh_2',
            provider: 'claude_code',
            sessionFile: '/home/alice/.claude/projects/repo/session.jsonl',
            gitRoot: '/repo',
            cwd: '/repo',
            title: 'Remote refresh task',
            promptDigest: 'Remote refresh task',
            latestProgressDigest: 'Updated remote summary',
            status: 'RUNNING',
            updatedAt: '2026-03-06T10:03:00.000Z',
            contentHash: 'remote456',
          },
        };
      },
    },
    observedSessionService: {
      refreshProjectObservedSession: async ({ session }) => ({
        item: session,
        wrotePlan: false,
      }),
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sessionId, 'sess_ssh_2');
  assert.equal(result.item.sessionId, 'sess_ssh_2');
  assert.equal(result.item.latestProgressDigest, 'Updated remote summary');
});
