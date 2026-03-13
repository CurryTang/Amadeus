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

test('listRuns returns shaped placeholder run descriptors', async () => {
  const service = createArisService({
    listLaunches: async () => ([
      {
        id: 'run_1',
        workflowType: 'auto_review_loop',
        status: 'running',
        runnerHost: 'wsl-main',
        activePhase: 'review',
        downstreamServerName: 'gpu-a100-1',
        latestScore: 6.2,
        latestVerdict: 'almost',
      },
    ]),
  });

  const runs = await service.listRuns();

  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, 'run_1');
  assert.equal(runs[0].runnerHost, 'wsl-main');
  assert.equal(runs[0].downstreamServerName, 'gpu-a100-1');
});

test('createLaunchRequest dispatches the run onto the WSL runner', async () => {
  let receivedLaunch = null;
  let receivedRunner = null;
  let persistedLaunch = null;

  const service = createArisService({
    listServers: async () => ([
      { id: 11, name: 'wsl-main', host: '127.0.0.1', user: 'czk', port: 22, ssh_key_path: '~/.ssh/id_rsa' },
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, ssh_key_path: '~/.ssh/id_rsa' },
    ]),
    dispatchLaunch: async ({ launch, runner }) => {
      receivedLaunch = launch;
      receivedRunner = runner;
      return {
        remotePid: 43210,
        logPath: '/srv/aris/default-project/.auto-researcher/aris-runs/run.log',
      };
    },
    saveLaunch: async (launch) => {
      persistedLaunch = launch;
    },
  });

  const launch = await service.createLaunchRequest({
    projectId: 'proj_1',
    workflowType: 'auto_review_loop',
    prompt: 'iterate until the paper is submission ready',
    remoteWorkspacePath: '/srv/aris/default-project',
    datasetRoot: '/mnt/data/huge',
    downstreamServerId: 12,
  });

  assert.equal(receivedRunner.id, 11);
  assert.equal(receivedLaunch.workflowType, 'auto_review_loop');
  assert.equal(receivedLaunch.remoteWorkspacePath, '/srv/aris/default-project');
  assert.equal(receivedLaunch.requiresUpload, false);
  assert.equal(launch.status, 'running');
  assert.equal(launch.activePhase, 'running_on_wsl');
  assert.equal(launch.remotePid, 43210);
  assert.equal(launch.logPath, '/srv/aris/default-project/.auto-researcher/aris-runs/run.log');
  assert.equal(persistedLaunch.id, launch.id);
  assert.equal(persistedLaunch.status, 'running');
});
