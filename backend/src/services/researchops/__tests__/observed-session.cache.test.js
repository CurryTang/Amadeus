'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  getObservedSessionCachePaths,
  refreshObservedSessionRecord,
} = require('../observed-session.service');

async function makeTempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'observed-session-project-'));
}

test('refreshObservedSessionRecord stores cache records under the project cache root', async () => {
  const projectPath = await makeTempProject();
  const sessionFile = path.join(projectPath, 'session.jsonl');
  await fs.writeFile(sessionFile, '{"type":"event"}\n', 'utf8');

  const { record } = await refreshObservedSessionRecord({
    projectPath,
    session: {
      provider: 'codex',
      agentType: 'codex',
      gitRoot: projectPath,
      cwd: projectPath,
      sessionFile,
      title: 'Implement observed-session cache',
      prompt: 'Implement observed-session cache',
      status: 'RUNNING',
      startedAt: '2026-03-05T10:00:00.000Z',
      updatedAt: '2026-03-05T10:00:00.000Z',
    },
    summarizeSessionFile: async () => ({
      latestProgressDigest: 'Reviewed existing session watcher',
      messageCount: 1,
      toolCallCount: 0,
      touchedFiles: [],
    }),
  });

  const paths = getObservedSessionCachePaths(projectPath, record.id);
  const raw = JSON.parse(await fs.readFile(paths.recordPath, 'utf8'));

  assert.equal(paths.dirPath, path.join(projectPath, '.researchops', 'cache', 'observed-sessions'));
  assert.equal(raw.id, record.id);
  assert.equal(raw.latestProgressDigest, 'Reviewed existing session watcher');
  assert.match(raw.contentHash, /^[a-f0-9]{40}$/);
});

test('refreshObservedSessionRecord reuses cached digest when the session content hash is unchanged', async () => {
  const projectPath = await makeTempProject();
  const sessionFile = path.join(projectPath, 'session.jsonl');
  await fs.writeFile(sessionFile, '{"type":"event"}\n', 'utf8');

  let summarizeCalls = 0;
  const session = {
    provider: 'codex',
    agentType: 'codex',
    gitRoot: projectPath,
    cwd: projectPath,
    sessionFile,
    title: 'Implement observed-session cache reuse',
    prompt: 'Implement observed-session cache reuse',
    status: 'RUNNING',
    startedAt: '2026-03-05T10:00:00.000Z',
    updatedAt: '2026-03-05T10:00:00.000Z',
  };

  const first = await refreshObservedSessionRecord({
    projectPath,
    session,
    summarizeSessionFile: async () => {
      summarizeCalls += 1;
      return {
        latestProgressDigest: 'Initial digest',
        messageCount: 2,
        toolCallCount: 1,
        touchedFiles: ['backend/src/services/researchops/observed-session.service.js'],
      };
    },
  });

  const second = await refreshObservedSessionRecord({
    projectPath,
    session,
    summarizeSessionFile: async () => {
      summarizeCalls += 1;
      throw new Error('summarizeSessionFile should not run when hash is unchanged');
    },
  });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(second.record.latestProgressDigest, 'Initial digest');
  assert.equal(second.record.contentHash, first.record.contentHash);
  assert.equal(summarizeCalls, 1);
});
