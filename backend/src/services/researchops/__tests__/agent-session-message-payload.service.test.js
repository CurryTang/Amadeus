'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAgentSessionMessageActionPayload,
  buildAgentSessionMessagesPayload,
  normalizeAgentSessionMessage,
} = require('../agent-session-message-payload.service');

test('normalizeAgentSessionMessage uppercases status and preserves core fields', () => {
  const message = normalizeAgentSessionMessage({
    id: 'msg_1',
    sessionId: 'sess_1',
    role: 'assistant',
    content: 'Done.',
    status: 'succeeded',
  });

  assert.equal(message.id, 'msg_1');
  assert.equal(message.sessionId, 'sess_1');
  assert.equal(message.role, 'assistant');
  assert.equal(message.content, 'Done.');
  assert.equal(message.status, 'SUCCEEDED');
});

test('buildAgentSessionMessagesPayload normalizes list items and preserves pagination fields', () => {
  const payload = buildAgentSessionMessagesPayload({
    items: [
      { id: 'msg_1', role: 'user', status: null },
      { id: 'msg_2', role: 'assistant', status: 'running' },
    ],
    total: 2,
  });

  assert.equal(payload.total, 2);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0].status, null);
  assert.equal(payload.items[1].status, 'RUNNING');
});

test('buildAgentSessionMessageActionPayload exposes session and run attempt semantics', () => {
  const payload = buildAgentSessionMessageActionPayload({
    session: { id: 'sess_1', status: 'running' },
    run: {
      id: 'run_123',
      projectId: 'proj_1',
      provider: 'codex',
      status: 'QUEUED',
      metadata: {
        treeNodeId: 'baseline_root',
        treeNodeTitle: 'Baseline Root',
      },
    },
    userMessage: { id: 'msg_1', role: 'user', status: null },
  });

  assert.equal(payload.session.status, 'RUNNING');
  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.treeNodeTitle, 'Baseline Root');
  assert.equal(payload.userMessage.id, 'msg_1');
});
