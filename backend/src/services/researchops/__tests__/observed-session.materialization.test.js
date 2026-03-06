'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  buildObservedSessionNode,
  syncProjectObservedSessions,
  upsertObservedSessionNodeInPlan,
} = require('../observed-session.service');

function buildBasePlan() {
  return {
    version: 1,
    project: 'Demo',
    vars: {},
    nodes: [
      {
        id: 'init',
        title: 'Project bootstrap',
        kind: 'setup',
        assumption: [],
        target: [],
        commands: [],
        checks: [],
      },
    ],
  };
}

test('buildObservedSessionNode creates a detached observed_agent node', () => {
  const node = buildObservedSessionNode({
    id: 'obs_1234567890abcdef',
    provider: 'codex',
    sessionId: 'turn_123',
    sessionFile: '/tmp/session.jsonl',
    contentHash: 'abcdef1234567890',
    classification: {
      decision: 'can_be_node',
      taskType: 'coding',
      goalSummary: 'Implement observed session sync in the runner area and tree',
      classifiedAt: '2026-03-05T10:05:00.000Z',
    },
    latestProgressDigest: 'Reading current tree and runner code',
  });

  assert.equal(node.kind, 'observed_agent');
  assert.equal(node.parent, undefined);
  assert.deepEqual(node.evidenceDeps, []);
  assert.deepEqual(node.tags, ['observed', 'external', 'codex']);
  assert.equal(node.ui?.detached, true);
  assert.equal(node.resources?.observedSession?.sessionId, 'turn_123');
  assert.equal(node.resources?.observedSession?.provider, 'codex');
  assert.equal(node.resources?.observedSession?.sessionFile, '/tmp/session.jsonl');
  assert.equal(node.resources?.observedSession?.contentHash, 'abcdef1234567890');
  assert.equal(node.target[0], 'Implement observed session sync in the runner area and tree');
});

test('upsertObservedSessionNodeInPlan inserts one node and updates it without duplicating', () => {
  const first = upsertObservedSessionNodeInPlan(buildBasePlan(), {
    id: 'obs_1234567890abcdef',
    provider: 'codex',
    sessionId: 'turn_123',
    sessionFile: '/tmp/session.jsonl',
    contentHash: 'hash_a',
    classification: {
      decision: 'can_be_node',
      taskType: 'coding',
      goalSummary: 'Implement observed session sync in the runner area and tree',
      classifiedAt: '2026-03-05T10:05:00.000Z',
    },
    latestProgressDigest: 'Reading current tree and runner code',
  });

  const second = upsertObservedSessionNodeInPlan(first.plan, {
    id: 'obs_1234567890abcdef',
    provider: 'codex',
    sessionId: 'turn_123',
    sessionFile: '/tmp/session.jsonl',
    contentHash: 'hash_b',
    classification: {
      decision: 'can_be_node',
      taskType: 'coding',
      goalSummary: 'Implement passive observed session sync in the runner area and tree',
      classifiedAt: '2026-03-05T10:10:00.000Z',
    },
    latestProgressDigest: 'Wiring API and tree surfaces',
  });

  assert.equal(first.created, true);
  assert.equal(first.plan.nodes.length, 2);
  assert.equal(second.created, false);
  assert.equal(second.plan.nodes.length, 2);
  assert.equal(second.node.id, first.node.id);
  assert.equal(second.node.title, 'Implement passive observed session sync in the runner area and tree');
  assert.equal(second.node.resources?.observedSession?.contentHash, 'hash_b');
  assert.equal(second.node.ui?.detached, true);
});

test('syncProjectObservedSessions materializes a qualifying observed session into the project plan', async () => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'observed-session-sync-'));
  const sessionFile = path.join(projectPath, 'session.jsonl');
  await fs.writeFile(sessionFile, '{"type":"event"}\n', 'utf8');

  const project = {
    id: 'proj_1',
    projectPath,
  };

  let writtenPlan = buildBasePlan();

  const result = await syncProjectObservedSessions({
    project,
    server: null,
    watcher: {
      getSessionsByPath: () => ([
        {
          provider: 'codex',
          agentType: 'codex',
          sessionId: 'turn_123',
          gitRoot: projectPath,
          cwd: projectPath,
          sessionFile,
          title: 'Implement observed session sync',
          prompt: 'Implement observed session sync in the runner and tree',
          status: 'RUNNING',
          startedAt: '2026-03-05T10:00:00.000Z',
          updatedAt: '2026-03-05T10:05:00.000Z',
        },
      ]),
    },
    summarizeSessionFile: async () => ({
      latestProgressDigest: 'Reading current runner and tree code',
      messageCount: 3,
      toolCallCount: 1,
      touchedFiles: [],
    }),
    classifyFn: async () => ({
      decision: 'can_be_node',
      taskType: 'coding',
      goalSummary: 'Implement observed session sync in the runner and tree',
      confidence: 0.91,
      reason: 'Concrete coding task with a clear deliverable',
    }),
    readProjectPlan: async () => ({
      plan: writtenPlan,
    }),
    writeProjectPlan: async ({ plan }) => {
      writtenPlan = plan;
      return { plan };
    },
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].hasDetachedNode, true);
  assert.match(result.items[0].detachedNodeId, /^observed_obs_/);
  assert.equal(result.items[0].detachedNodeTitle, 'Implement observed session sync in the runner and tree');
  assert.equal(result.wrotePlan, true);
  assert.equal(writtenPlan.nodes.length, 2);
  assert.equal(writtenPlan.nodes[1].kind, 'observed_agent');
});
