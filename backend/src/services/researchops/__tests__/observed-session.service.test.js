'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildObservedSessionId,
  normalizeObservedSession,
  selectObservedSessionsForProject,
} = require('../observed-session.service');

test('selectObservedSessionsForProject filters by exact git root match', () => {
  const items = selectObservedSessionsForProject([
    {
      id: 'codex-a',
      provider: 'codex',
      gitRoot: '/repo',
      cwd: '/repo',
      sessionFile: '/tmp/a.jsonl',
      title: 'Implement API sync',
      prompt: 'Implement API sync',
      updatedAt: '2026-03-05T10:00:00.000Z',
    },
    {
      id: 'codex-b',
      provider: 'codex',
      gitRoot: '/repo/subdir',
      cwd: '/repo/subdir',
      sessionFile: '/tmp/b.jsonl',
      title: 'Nested path run',
      prompt: 'Nested path run',
      updatedAt: '2026-03-05T09:00:00.000Z',
    },
    {
      id: 'claude-c',
      provider: 'claude_code',
      gitRoot: '/other',
      cwd: '/other',
      sessionFile: '/tmp/c.jsonl',
      title: 'Other project',
      prompt: 'Other project',
      updatedAt: '2026-03-05T08:00:00.000Z',
    },
  ], '/repo/');

  assert.equal(items.length, 1);
  assert.equal(items[0].gitRoot, '/repo');
  assert.equal(items[0].sessionFile, '/tmp/a.jsonl');
});

test('buildObservedSessionId is stable for provider and session file', () => {
  const a = buildObservedSessionId({
    provider: 'codex',
    sessionFile: '/Users/alice/.codex/sessions/2026/03/05/rollout-1.jsonl',
  });
  const b = buildObservedSessionId({
    provider: 'codex',
    sessionFile: '/Users/alice/.codex/sessions/2026/03/05/rollout-1.jsonl',
  });
  const c = buildObservedSessionId({
    provider: 'claude_code',
    sessionFile: '/Users/alice/.codex/sessions/2026/03/05/rollout-1.jsonl',
  });

  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^obs_[a-f0-9]{16,}$/);
});

test('normalizeObservedSession preserves provider, path, prompt, and timestamps', () => {
  const normalized = normalizeObservedSession({
    sessionId: 'turn_123',
    provider: 'codex',
    agentType: 'codex',
    gitRoot: '/repo',
    cwd: '/repo',
    sessionFile: '/tmp/codex-session.jsonl',
    title: 'Implement observed session sync',
    prompt: 'Implement observed session sync in the runner and tree',
    status: 'RUNNING',
    startedAt: '2026-03-05T10:00:00.000Z',
    updatedAt: '2026-03-05T10:03:00.000Z',
  });

  assert.equal(normalized.provider, 'codex');
  assert.equal(normalized.agentType, 'codex');
  assert.equal(normalized.gitRoot, '/repo');
  assert.equal(normalized.sessionFile, '/tmp/codex-session.jsonl');
  assert.equal(normalized.title, 'Implement observed session sync');
  assert.equal(normalized.promptDigest, 'Implement observed session sync in the runner and tree');
  assert.equal(normalized.status, 'RUNNING');
  assert.equal(normalized.startedAt, '2026-03-05T10:00:00.000Z');
  assert.equal(normalized.updatedAt, '2026-03-05T10:03:00.000Z');
  assert.equal(normalized.sessionId, 'turn_123');
  assert.match(normalized.id, /^obs_[a-f0-9]{16,}$/);
});
