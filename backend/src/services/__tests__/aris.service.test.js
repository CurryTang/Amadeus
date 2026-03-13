const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createArisService,
  ARIS_WORKFLOW_TYPES,
} = require('../aris.service');

test('ARIS workflow catalog contains the expected launcher actions', async () => {
  const service = createArisService();
  const catalog = await service.getWorkspaceContext();

  assert.deepEqual(
    catalog.quickActions.map((item) => item.id),
    ARIS_WORKFLOW_TYPES
  );
  assert.equal(catalog.runner.type, 'wsl');
});

test('createLaunchRequest validates remote dataset roots as references, not uploads', async () => {
  const service = createArisService({
    listServers: async () => ([
      { id: 11, name: 'wsl-main', host: '127.0.0.1', user: 'czk', port: 22, runner_role: 'aris_wsl' },
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, runner_role: 'experiment' },
    ]),
    dispatchLaunch: async () => ({
      remotePid: 12345,
      logPath: '/srv/aris/proj_1/.auto-researcher/aris-runs/run.log',
      runDirectory: '/srv/aris/proj_1/.auto-researcher/aris-runs/aris_run_retry',
    }),
  });

  const launch = await service.createLaunchRequest({
    projectId: 'proj_1',
    workflowType: 'run_experiment',
    prompt: 'run the new ablation suite',
    datasetRoot: '/mnt/data/huge',
    downstreamServerId: 12,
  });

  assert.equal(launch.projectId, 'proj_1');
  assert.equal(launch.workflowType, 'run_experiment');
  assert.equal(launch.runnerServerId, 11);
  assert.equal(launch.downstreamServerId, 12);
  assert.equal(launch.datasetRoot, '/mnt/data/huge');
  assert.equal(launch.requiresUpload, false);
});

test('listRuns returns shaped run descriptors', async () => {
  const service = createArisService({
    listLaunches: async () => ([
      {
        id: 'run_1',
        projectId: 'proj_1',
        workflowType: 'auto_review_loop',
        prompt: 'iterate until score improves',
        status: 'running',
        runnerHost: 'wsl-main',
        activePhase: 'review',
        downstreamServerName: 'gpu-a100-1',
        latestScore: 6.2,
        latestVerdict: 'almost',
        summary: 'Remote log: /tmp/run.log',
        startedAt: '2026-03-13T12:00:00.000Z',
        updatedAt: '2026-03-13T12:05:00.000Z',
        logPath: '/tmp/run.log',
      },
    ]),
  });

  const runs = await service.listRuns();

  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, 'run_1');
  assert.equal(runs[0].runnerHost, 'wsl-main');
  assert.equal(runs[0].downstreamServerName, 'gpu-a100-1');
  assert.equal(runs[0].updatedAt, '2026-03-13T12:05:00.000Z');
});

test('getRun returns a full detail payload for a known launch', async () => {
  const service = createArisService({
    getLaunchById: async (runId) => ({
      id: runId,
      projectId: 'proj_1',
      workflowType: 'literature_review',
      prompt: 'summarize the latest diffusion work',
      status: 'running',
      activePhase: 'running_on_wsl',
      summary: 'Remote log: /srv/aris/proj_1/run.log',
      runnerHost: 'wsl-main',
      downstreamServerName: 'gpu-a100-1',
      startedAt: '2026-03-13T12:00:00.000Z',
      updatedAt: '2026-03-13T12:03:00.000Z',
      logPath: '/srv/aris/proj_1/run.log',
      runDirectory: '/srv/aris/proj_1/.auto-researcher/aris-runs/run_123',
    }),
  });

  const detail = await service.getRun('run_123');

  assert.equal(detail.id, 'run_123');
  assert.equal(detail.workflowType, 'literature_review');
  assert.equal(detail.logPath, '/srv/aris/proj_1/run.log');
  assert.equal(detail.runDirectory, '/srv/aris/proj_1/.auto-researcher/aris-runs/run_123');
});

test('retryRun relaunches an existing run with the original configuration', async () => {
  const dispatches = [];
  const persisted = [];
  const service = createArisService({
    listServers: async () => ([
      { id: 11, name: 'wsl-main', host: '127.0.0.1', user: 'czk', port: 22, ssh_key_path: '~/.ssh/id_rsa' },
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, ssh_key_path: '~/.ssh/id_rsa' },
    ]),
    getLaunchById: async () => ({
      id: 'aris_run_1',
      projectId: 'proj_1',
      workflowType: 'auto_review_loop',
      prompt: 'iterate until the paper is submission ready',
      runnerServerId: 11,
      runnerHost: 'wsl-main',
      downstreamServerId: 12,
      downstreamServerName: 'gpu-a100-1',
      remoteWorkspacePath: '/srv/aris/default-project',
      datasetRoot: '/mnt/data/huge',
      requiresUpload: false,
      status: 'failed',
      activePhase: 'needs_retry',
      latestScore: 6.1,
      latestVerdict: 'almost',
      startedAt: '2026-03-13T12:00:00.000Z',
      updatedAt: '2026-03-13T12:05:00.000Z',
      summary: 'Remote log: /srv/aris/default-project/.auto-researcher/aris-runs/run.log',
      logPath: '/srv/aris/default-project/.auto-researcher/aris-runs/run.log',
      runDirectory: '/srv/aris/default-project/.auto-researcher/aris-runs/aris_run_1',
    }),
    dispatchLaunch: async ({ launch, runner }) => {
      dispatches.push({ launch, runner });
      return {
        remotePid: 43210,
        logPath: '/srv/aris/default-project/.auto-researcher/aris-runs/retry.log',
        runDirectory: '/srv/aris/default-project/.auto-researcher/aris-runs/aris_run_retry',
      };
    },
    saveLaunch: async (launch) => {
      persisted.push(launch);
    },
  });

  const retried = await service.retryRun('aris_run_1');

  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].launch.workflowType, 'auto_review_loop');
  assert.equal(dispatches[0].launch.prompt, 'iterate until the paper is submission ready');
  assert.equal(retried.status, 'running');
  assert.equal(retried.retryOfRunId, 'aris_run_1');
  assert.equal(persisted[0].retryOfRunId, 'aris_run_1');
});
