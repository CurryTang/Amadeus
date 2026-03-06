'use strict';

process.env.DB_PROVIDER = 'memory';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const store = require('../store');
const runner = require('../runner');
const orchestrator = require('../orchestrator');

async function waitForRun(userId, runId, predicate, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const run = await store.getRun(userId, runId);
    if (predicate(run)) return run;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return store.getRun(userId, runId);
}

test('executeRun can start a freshly queued v2 run', async () => {
  const projectPath = path.join(os.tmpdir(), `runner-direct-${Date.now()}`);
  await fs.mkdir(projectPath, { recursive: true });

  const project = await store.createProject('czk', {
    name: `Runner Direct ${Date.now()}`,
    locationType: 'local',
    projectPath,
    kbFolderPath: projectPath,
  });

  const run = await store.enqueueRun('czk', {
    projectId: project.id,
    serverId: 'local-default',
    runType: 'EXPERIMENT',
    schemaVersion: '2.0',
    workflow: [
      {
        id: 'step_bootstrap',
        type: 'bash.run',
        inputs: {
          command: 'echo ok',
        },
      },
    ],
    metadata: {
      command: 'bash',
      args: ['-lc', 'echo ok'],
      cwd: projectPath,
    },
  });

  const originalExecuteV2Run = orchestrator.executeV2Run;
  let observedRunStatus = null;
  orchestrator.executeV2Run = async (userId, queuedRun) => {
    const current = await store.getRun(userId, queuedRun.id);
    observedRunStatus = current?.status || null;
    return { continuation: null };
  };

  try {
    await assert.doesNotReject(() => runner.executeRun('czk', run));
    const finalRun = await waitForRun(
      'czk',
      run.id,
      (current) => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(String(current?.status || '')),
      { timeoutMs: 5000, intervalMs: 25 }
    );

    assert.equal(observedRunStatus, 'RUNNING');
    assert.equal(finalRun?.status, 'SUCCEEDED');
  } finally {
    orchestrator.executeV2Run = originalExecuteV2Run;
  }
});
