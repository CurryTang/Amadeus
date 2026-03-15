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
    ['custom_run', ...ARIS_WORKFLOW_TYPES]
  );
  assert.deepEqual(catalog.projects, []);
});

test('getWorkspaceContext exposes saved projects, targets, and available ssh servers', async () => {
  const service = createArisService({
    listProjects: async () => ([
      {
        id: 'proj_1',
        name: 'Paper Agent',
        localProjectPath: 'paper-agent',
        clientWorkspaceId: 'cw_1',
        syncExcludes: ['local/', 'outputs/'],
      },
    ]),
    listTargets: async () => ([
      {
        id: 'target_1',
        projectId: 'proj_1',
        sshServerId: 12,
        sshServerName: 'gpu-a100-1',
        remoteProjectPath: '/srv/aris/paper-agent',
        remoteDatasetRoot: '/mnt/data/paper-agent',
      },
    ]),
    listServers: async () => ([
      { id: 11, name: 'wsl-main', host: '127.0.0.1', user: 'czk', port: 22 },
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22 },
      { id: 13, name: 'gpu-h100-2', host: '10.0.0.9', user: 'ubuntu', port: 22 },
    ]),
  });

  const context = await service.getWorkspaceContext();

  assert.equal(context.projects.length, 1);
  assert.equal(context.targets.length, 1);
  assert.equal(context.targets[0].id, 'target_1');
  assert.equal(context.availableSshServers.length, 3);
  assert.equal(context.defaultSelections.projectId, 'proj_1');
  assert.equal(context.defaultSelections.targetId, 'target_1');
});

test('createProject persists browser-linked local workspace metadata', async () => {
  const savedProjects = [];
  const service = createArisService({
    saveProject: async (project) => {
      savedProjects.push(project);
    },
    buildProjectFiles: async ({ projectName, localProjectPath }) => ([
      {
        path: '.claude/skills/research-lit/SKILL.md',
        content: `# ${projectName} -> ${localProjectPath}\n`,
        writeMode: 'replace',
      },
    ]),
  });

  const project = await service.createProject({
    name: 'Vision Agent',
    clientWorkspaceId: 'cw_vision',
    localProjectPath: 'vision-agent',
    syncExcludes: ['local/', 'checkpoints/'],
  });

  assert.equal(project.name, 'Vision Agent');
  assert.equal(project.clientWorkspaceId, 'cw_vision');
  assert.deepEqual(project.syncExcludes, ['local/', 'checkpoints/']);
  assert.deepEqual(project.projectFiles, [
    {
      path: '.claude/skills/research-lit/SKILL.md',
      content: '# Vision Agent -> vision-agent\n',
      writeMode: 'replace',
    },
  ]);
  assert.equal(savedProjects.length, 1);
});

test('createTarget persists a reusable deployment target for a project', async () => {
  const savedTargets = [];
  const service = createArisService({
    listServers: async () => ([
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, shared_fs_enabled: 1, shared_fs_group: 'lab-nfs' },
    ]),
    getProjectById: async () => ({
      id: 'proj_1',
      name: 'Paper Agent',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'paper-agent',
      syncExcludes: ['local/'],
    }),
    saveTarget: async (target) => {
      savedTargets.push(target);
    },
  });

  const target = await service.createTarget('proj_1', {
    sshServerId: 12,
    remoteProjectPath: '/srv/aris/paper-agent',
    remoteDatasetRoot: '/mnt/data/paper-agent',
    remoteCheckpointRoot: '/mnt/checkpoints/paper-agent',
  });

  assert.equal(target.projectId, 'proj_1');
  assert.equal(target.sshServerId, 12);
  assert.equal(target.remoteProjectPath, '/srv/aris/paper-agent');
  assert.equal(target.sharedFsGroup, 'lab-nfs');
  assert.equal(savedTargets.length, 1);
});

test('createProject can persist project settings with no remote endpoints', async () => {
  const savedProjects = [];
  const deletedTargetIds = [];
  const service = createArisService({
    saveProject: async (project) => {
      savedProjects.push(project);
    },
    listTargets: async () => ([
      {
        id: 'target_old',
        projectId: 'proj_existing',
        sshServerId: 12,
        sshServerName: 'gpu-a100-1',
        remoteProjectPath: '/srv/aris/old',
      },
    ]),
    deleteTarget: async (targetId) => {
      deletedTargetIds.push(targetId);
    },
  });

  const project = await service.createProject({
    name: 'No Remote Project',
    clientWorkspaceId: 'cw_none',
    localProjectPath: 'no-remote-project',
    syncExcludes: ['local/'],
    noRemote: true,
    remoteEndpoints: [],
  });

  assert.equal(project.name, 'No Remote Project');
  assert.equal(savedProjects.length, 1);
  assert.deepEqual(project.targets, []);
  assert.deepEqual(deletedTargetIds, []);
});

test('updateProject reconciles remote endpoints in one save', async () => {
  const savedProjects = [];
  const savedTargets = [];
  const deletedTargetIds = [];
  const service = createArisService({
    getProjectById: async () => ({
      id: 'proj_1',
      name: 'Paper Agent',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'paper-agent',
      syncExcludes: ['local/'],
    }),
    listTargets: async () => ([
      {
        id: 'target_keep',
        projectId: 'proj_1',
        sshServerId: 12,
        sshServerName: 'gpu-a100-1',
        remoteProjectPath: '/srv/aris/keep',
      },
      {
        id: 'target_remove',
        projectId: 'proj_1',
        sshServerId: 13,
        sshServerName: 'gpu-h100-2',
        remoteProjectPath: '/srv/aris/remove',
      },
    ]),
    listServers: async () => ([
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, shared_fs_group: 'lab-nfs' },
      { id: 13, name: 'gpu-h100-2', host: '10.0.0.9', user: 'ubuntu', port: 22, shared_fs_group: '' },
      { id: 14, name: 'gpu-l40-3', host: '10.0.0.10', user: 'ubuntu', port: 22, shared_fs_group: 'lab-nfs' },
    ]),
    saveProject: async (project) => {
      savedProjects.push(project);
    },
    saveTarget: async (target) => {
      savedTargets.push(target);
    },
    deleteTarget: async (targetId) => {
      deletedTargetIds.push(targetId);
    },
  });

  const project = await service.updateProject('proj_1', {
    name: 'Paper Agent Updated',
    syncExcludes: ['local/', 'outputs/'],
    remoteEndpoints: [
      {
        id: 'target_keep',
        sshServerId: 12,
        remoteProjectPath: '/srv/aris/keep-updated',
        remoteDatasetRoot: '/mnt/data/paper-agent',
        remoteCheckpointRoot: '/mnt/checkpoints/paper-agent',
        remoteOutputRoot: '/mnt/outputs/paper-agent',
      },
      {
        sshServerId: 14,
        remoteProjectPath: '/srv/aris/new-endpoint',
        remoteDatasetRoot: '',
        remoteCheckpointRoot: '',
        remoteOutputRoot: '',
      },
    ],
  });

  assert.equal(savedProjects.length, 1);
  assert.equal(savedTargets.length, 2);
  assert.deepEqual(deletedTargetIds, ['target_remove']);
  assert.equal(project.targets.length, 2);
  assert.equal(project.targets[0].id, 'target_keep');
  assert.equal(project.targets[0].remoteProjectPath, '/srv/aris/keep-updated');
  assert.equal(project.targets[1].sshServerId, 14);
  assert.match(project.targets[1].id, /^aris_target_/);
});

test('deleteTarget removes one saved remote endpoint', async () => {
  const deletedTargetIds = [];
  const service = createArisService({
    getTargetById: async () => ({
      id: 'target_1',
      projectId: 'proj_1',
      sshServerId: 12,
      sshServerName: 'gpu-a100-1',
      remoteProjectPath: '/srv/aris/paper-agent',
    }),
    deleteTarget: async (targetId) => {
      deletedTargetIds.push(targetId);
    },
  });

  const deleted = await service.deleteTarget('target_1');

  assert.equal(deleted.id, 'target_1');
  assert.deepEqual(deletedTargetIds, ['target_1']);
});

test('deleteProject removes project config after local workspace cleanup confirmation path succeeds', async () => {
  const deletedProjectIds = [];
  const service = createArisService({
    getProjectById: async () => ({
      id: 'proj_1',
      name: 'Paper Agent',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'paper-agent',
      syncExcludes: ['local/'],
    }),
    deleteProject: async (projectId) => {
      deletedProjectIds.push(projectId);
    },
  });

  const deleted = await service.deleteProject('proj_1');

  assert.equal(deleted.id, 'proj_1');
  assert.deepEqual(deletedProjectIds, ['proj_1']);
});

test('createLaunchRequest resolves launch context from project plus target', async () => {
  const service = createArisService({
    getProjectById: async () => ({
      id: 'proj_1',
      name: 'Paper Agent',
      clientWorkspaceId: 'cw_1',
      localProjectPath: 'paper-agent',
      syncExcludes: ['local/', 'outputs/'],
    }),
    getTargetById: async () => ({
      id: 'target_1',
      projectId: 'proj_1',
      sshServerId: 12,
      sshServerName: 'gpu-a100-1',
      remoteProjectPath: '/srv/aris/paper-agent',
      remoteDatasetRoot: '/mnt/data/paper-agent',
      remoteCheckpointRoot: '/mnt/checkpoints/paper-agent',
      sharedFsGroup: 'lab-nfs',
    }),
    listServers: async () => ([
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22, shared_fs_enabled: 1, shared_fs_group: 'lab-nfs' },
    ]),
    dispatchLaunch: async () => ({
      remotePid: 12345,
      logPath: '/srv/aris/proj_1/.auto-researcher/aris-runs/run.log',
      runDirectory: '/srv/aris/proj_1/.auto-researcher/aris-runs/aris_run_retry',
    }),
  });

  const launch = await service.createLaunchRequest({
    projectId: 'proj_1',
    targetId: 'target_1',
    workflowType: 'run_experiment',
    prompt: 'run the new ablation suite',
  });

  assert.equal(launch.projectId, 'proj_1');
  assert.equal(launch.targetId, 'target_1');
  assert.equal(launch.workflowType, 'run_experiment');
  assert.equal(launch.runnerServerId, 12);
  assert.equal(launch.datasetRoot, '/mnt/data/paper-agent');
  assert.equal(launch.remoteWorkspacePath, '/srv/aris/paper-agent');
  assert.match(launch.summary, /shared fs|shared filesystem|shared-fs/i);
  assert.equal(launch.requiresUpload, false);
});

test('createLaunchRequest supports fully custom runs on saved targets', async () => {
  const service = createArisService({
    getProjectById: async () => ({
      id: 'custom-project',
      name: 'Custom Project',
      clientWorkspaceId: 'cw_custom',
      localProjectPath: 'custom-project',
      syncExcludes: [],
    }),
    getTargetById: async () => ({
      id: 'target_custom',
      projectId: 'custom-project',
      sshServerId: 22,
      sshServerName: 'gpu-lab',
      remoteProjectPath: '/srv/aris/custom',
      remoteDatasetRoot: '',
      remoteCheckpointRoot: '',
    }),
    listServers: async () => ([
      { id: 22, name: 'gpu-lab', host: '10.0.0.22', user: 'ubuntu', port: 22 },
    ]),
    dispatchLaunch: async () => ({
      remotePid: 65432,
      logPath: '/srv/aris/custom/.auto-researcher/aris-runs/run.log',
      runDirectory: '/srv/aris/custom/.auto-researcher/aris-runs/run_custom',
    }),
  });

  const launch = await service.createLaunchRequest({
    projectId: 'custom-project',
    targetId: 'target_custom',
    workflowType: 'custom_run',
    prompt: 'Read the workspace notes and design a new evaluation loop',
  });

  assert.equal(launch.workflowType, 'custom_run');
  assert.equal(launch.runnerServerId, 22);
  assert.equal(launch.targetId, 'target_custom');
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
    listRunActions: async (runId) => ([
      {
        id: 'action_1',
        runId,
        actionType: 'continue',
        prompt: 'Continue the review loop with stronger baselines',
        status: 'queued',
        summary: '',
        createdAt: '2026-03-13T12:04:00.000Z',
        updatedAt: '2026-03-13T12:04:00.000Z',
      },
    ]),
  });

  const detail = await service.getRun('run_123');

  assert.equal(detail.id, 'run_123');
  assert.equal(detail.workflowType, 'literature_review');
  assert.equal(detail.logPath, '/srv/aris/proj_1/run.log');
  assert.equal(detail.runDirectory, '/srv/aris/proj_1/.auto-researcher/aris-runs/run_123');
  assert.equal(detail.actions.length, 1);
  assert.equal(detail.actions[0].actionType, 'continue');
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

test('createRunAction persists a follow-up action on an existing run', async () => {
  const savedActions = [];
  const service = createArisService({
    listServers: async () => ([
      { id: 11, name: 'wsl-main', host: '127.0.0.1', user: 'czk', port: 22 },
      { id: 12, name: 'gpu-a100-1', host: '10.0.0.8', user: 'ubuntu', port: 22 },
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
      status: 'running',
      activePhase: 'running_on_wsl',
      startedAt: '2026-03-13T12:00:00.000Z',
      updatedAt: '2026-03-13T12:05:00.000Z',
      logPath: '/srv/aris/default-project/.auto-researcher/aris-runs/run.log',
      runDirectory: '/srv/aris/default-project/.auto-researcher/aris-runs/aris_run_1',
    }),
    saveRunAction: async (action) => {
      savedActions.push(action);
    },
    dispatchRunAction: async () => ({
      status: 'queued',
      summary: 'Queued on the parent run workspace',
    }),
  });

  const action = await service.createRunAction('aris_run_1', {
    actionType: 'run_experiment',
    prompt: 'Run the larger ablation on the same project',
    downstreamServerId: 12,
  });

  assert.equal(action.runId, 'aris_run_1');
  assert.equal(action.actionType, 'run_experiment');
  assert.equal(action.downstreamServerId, 12);
  assert.equal(action.summary, 'Queued on the parent run workspace');
  assert.equal(savedActions.length, 1);
});
