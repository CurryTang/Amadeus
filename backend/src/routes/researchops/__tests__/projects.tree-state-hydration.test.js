'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('runStatusToNodeStatus maps run lifecycle states into tree node states', () => {
  assert.equal(projectsRouter.runStatusToNodeStatus('SUCCEEDED'), 'PASSED');
  assert.equal(projectsRouter.runStatusToNodeStatus('FAILED'), 'FAILED');
  assert.equal(projectsRouter.runStatusToNodeStatus('CANCELLED'), 'FAILED');
  assert.equal(projectsRouter.runStatusToNodeStatus('RUNNING'), 'RUNNING');
  assert.equal(projectsRouter.runStatusToNodeStatus('PROVISIONING'), 'RUNNING');
  assert.equal(projectsRouter.runStatusToNodeStatus('QUEUED'), 'QUEUED');
  assert.equal(projectsRouter.runStatusToNodeStatus(''), '');
});

test('hydrateTreeStateRunStatuses updates last-run-backed node state without disturbing other nodes', async () => {
  const hydrated = await projectsRouter.hydrateTreeStateRunStatuses('user_1', {
    nodes: {
      node_eval: {
        status: 'PLANNED',
        lastRunId: 'run_123',
      },
      node_idle: {
        status: 'BLOCKED',
        manualApproved: false,
      },
    },
  }, {
    getRunFn: async (_userId, runId) => {
      if (runId !== 'run_123') return null;
      return {
        id: 'run_123',
        status: 'SUCCEEDED',
        lastMessage: 'Execution completed.',
        updatedAt: '2026-03-06T20:00:00.000Z',
      };
    },
  });

  assert.equal(hydrated.nodes.node_eval.status, 'PASSED');
  assert.equal(hydrated.nodes.node_eval.lastRunStatus, 'SUCCEEDED');
  assert.equal(hydrated.nodes.node_eval.lastRunMessage, 'Execution completed.');
  assert.equal(hydrated.nodes.node_eval.lastRunUpdatedAt, '2026-03-06T20:00:00.000Z');
  assert.equal(hydrated.nodes.node_idle.status, 'BLOCKED');
  assert.equal(hydrated.nodes.node_idle.manualApproved, false);
});
