'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentSessionDetailPayload,
  buildAgentSessionListPayload,
  normalizeAgentSession,
} = require('../agent-session-payload.service');

test('normalizeAgentSession uppercases status fields and preserves core session data', () => {
  const session = normalizeAgentSession({
    id: 'sess_1',
    projectId: 'proj_1',
    provider: 'codex_cli',
    status: 'running',
    lastRunStatus: 'queued',
  });

  assert.equal(session.id, 'sess_1');
  assert.equal(session.projectId, 'proj_1');
  assert.equal(session.provider, 'codex_cli');
  assert.equal(session.status, 'RUNNING');
  assert.equal(session.lastRunStatus, 'QUEUED');
});

test('buildAgentSessionListPayload normalizes each returned session', () => {
  const payload = buildAgentSessionListPayload({
    sessions: [
      { id: 'sess_1', status: 'idle', lastRunStatus: 'succeeded' },
    ],
  });

  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].status, 'IDLE');
  assert.equal(payload.sessions[0].lastRunStatus, 'SUCCEEDED');
});

test('buildAgentSessionDetailPayload exposes active attempt semantics while keeping activeRun', () => {
  const payload = buildAgentSessionDetailPayload({
    session: { id: 'sess_1', status: 'running' },
    activeRun: {
      id: 'run_123',
      projectId: 'proj_1',
      provider: 'codex',
      status: 'RUNNING',
      metadata: {
        treeNodeId: 'baseline_root',
        treeNodeTitle: 'Baseline Root',
      },
    },
  });

  assert.equal(payload.session.status, 'RUNNING');
  assert.equal(payload.activeRun.id, 'run_123');
  assert.equal(payload.activeAttempt.id, 'run_123');
  assert.equal(payload.activeAttempt.treeNodeId, 'baseline_root');
});
