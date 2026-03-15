import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARIS_QUICK_ACTIONS,
  buildArisProjectRow,
  buildArisRunActionRow,
  buildArisRunCard,
  buildArisRunDetail,
  buildArisTargetRow,
  buildArisWorkspaceContext,
} from './arisWorkspacePresentation.js';

test('ARIS quick actions expose launcher presets without locking input', () => {
  assert.equal(ARIS_QUICK_ACTIONS[0].id, 'custom_run');
  assert.match(ARIS_QUICK_ACTIONS[1].prefillPrompt, /literature|related work/i);
  assert.equal(
    ARIS_QUICK_ACTIONS.map((action) => action.id).join(','),
    [
      'custom_run',
      'literature_review',
      'idea_discovery',
      'run_experiment',
      'auto_review_loop',
      'paper_writing',
      'paper_improvement',
      'full_pipeline',
      'monitor_experiment',
    ].join(',')
  );
  assert.equal(ARIS_QUICK_ACTIONS[0].workflowType, 'custom_run');
});

test('buildArisRunCard marks target-server runs distinctly from experiment dispatch', () => {
  const card = buildArisRunCard({
    id: 'run_1',
    status: 'running',
    workflowType: 'run_experiment',
    runnerHost: 'wsl-main',
    activePhase: 'dispatch_experiment',
    downstreamServerName: 'gpu-a100-1',
    latestScore: 5.8,
    latestVerdict: 'not ready',
  });

  assert.equal(card.statusLabel, 'Dispatching experiment');
  assert.equal(card.runnerLabel, 'Server: wsl-main');
  assert.equal(card.destinationLabel, 'Target: gpu-a100-1');
  assert.equal(card.scoreLabel, '5.8/10 · not ready');
});

test('buildArisWorkspaceContext is built from project plus saved target context', () => {
  const context = buildArisWorkspaceContext({
    project: {
      id: 'proj_1',
      name: 'Paper Agent',
      localProjectPath: 'paper-agent',
      syncExcludes: ['local/', 'checkpoints/'],
    },
    target: {
      id: 'target_1',
      sshServerName: 'compute.example.edu',
      remoteProjectPath: '/srv/aris/paper-agent',
      remoteDatasetRoot: '/mnt/data/big-dataset',
      remoteCheckpointRoot: '/mnt/checkpoints/paper-agent',
    },
  });

  assert.equal(context.projectLabel, 'Paper Agent');
  assert.equal(context.localPathLabel, 'Client workspace: paper-agent');
  assert.equal(context.targetLabel, 'Target: compute.example.edu');
  assert.equal(context.workspaceLabel, '/srv/aris/paper-agent');
  assert.equal(context.datasetLabel, 'Dataset: /mnt/data/big-dataset');
  assert.equal(context.checkpointLabel, 'Checkpoints: /mnt/checkpoints/paper-agent');
});

test('buildArisRunCard handles sparse payloads gracefully', () => {
  const card = buildArisRunCard({
    id: 'run_2',
    status: 'queued',
  });

  assert.equal(card.title, 'ARIS Run');
  assert.equal(card.statusLabel, 'Queued');
  assert.equal(card.runnerLabel, 'Target server pending');
  assert.equal(card.destinationLabel, 'No saved target');
});

test('buildArisRunDetail exposes workspace, dataset, and action history', () => {
  const detail = buildArisRunDetail({
    id: 'run_9',
    workflowType: 'custom_run',
    prompt: 'Investigate sparse MoE routing failures',
    runnerHost: 'wsl-main',
    downstreamServerName: 'gpu-a100-1',
    remoteWorkspacePath: '/srv/aris/proj_9',
    datasetRoot: '/mnt/data/moe',
    logPath: '/srv/aris/proj_9/.auto-researcher/aris-runs/run.log',
    runDirectory: '/srv/aris/proj_9/.auto-researcher/aris-runs/run_9',
    actions: [
      {
        id: 'action_1',
        actionType: 'run_experiment',
        prompt: 'Launch a longer ablation on gpu-a100-1',
        status: 'queued',
        downstreamServerName: 'gpu-a100-1',
        createdAt: '2026-03-13T23:00:00.000Z',
      },
    ],
  });

  assert.equal(detail.workflowLabel, 'Custom Run');
  assert.equal(detail.workspaceLabel, '/srv/aris/proj_9');
  assert.equal(detail.datasetLabel, '/mnt/data/moe');
  assert.equal(detail.actionRows.length, 1);
  assert.equal(detail.actionRows[0].targetLabel, 'Target: gpu-a100-1');
});

test('buildArisRunActionRow handles follow-up actions without target overrides', () => {
  const row = buildArisRunActionRow({
    id: 'action_2',
    actionType: 'continue',
    prompt: 'Continue the loop with a stronger baseline comparison',
    status: 'running',
    createdAt: '2026-03-13T23:10:00.000Z',
  });

  assert.equal(row.actionLabel, 'Continue Run');
  assert.equal(row.statusLabel, 'Running');
  assert.equal(row.targetLabel, 'Same target as parent run');
});

test('buildArisProjectRow exposes local workspace metadata without inventing a default project', () => {
  const row = buildArisProjectRow({
    id: 'proj_2',
    name: 'Vision Agent',
    localProjectPath: 'vision-agent',
    syncExcludes: ['local/', 'outputs/'],
    targetCount: 2,
  });

  assert.equal(row.title, 'Vision Agent');
  assert.equal(row.localPathLabel, 'Local workspace: vision-agent');
  assert.equal(row.targetCountLabel, '2 saved targets');
  assert.equal(row.remoteModeLabel, 'Remote servers configured');
  assert.equal(row.excludeSummary, 'Excludes: local/, outputs/');
});

test('buildArisProjectRow marks projects without remotes clearly', () => {
  const row = buildArisProjectRow({
    id: 'proj_3',
    name: 'AutoRDL',
    localProjectPath: 'AutoRDL',
    syncExcludes: ['local/', 'outputs/', 'checkpoints/'],
    targetCount: 0,
    noRemote: true,
  });

  assert.equal(row.targetCountLabel, '0 saved targets');
  assert.equal(row.remoteModeLabel, 'No remote servers');
});

test('buildArisTargetRow exposes remote server and root paths', () => {
  const row = buildArisTargetRow({
    id: 'target_3',
    sshServerName: 'grandhaven.egr.msu.edu',
    remoteProjectPath: '/home/czk/project-a',
    remoteDatasetRoot: '/mnt/data/project-a',
    remoteCheckpointRoot: '/mnt/checkpoints/project-a',
    sharedFsGroup: 'lab-nfs',
  });

  assert.equal(row.title, 'grandhaven.egr.msu.edu');
  assert.equal(row.remotePathLabel, '/home/czk/project-a');
  assert.equal(row.datasetLabel, 'Dataset: /mnt/data/project-a');
  assert.equal(row.checkpointLabel, 'Checkpoints: /mnt/checkpoints/project-a');
  assert.equal(row.sharedFsLabel, 'Shared FS: lab-nfs');
});

test('buildArisWorkspaceContext does not invent a default project when none is selected', () => {
  const context = buildArisWorkspaceContext({});

  assert.equal(context.projectLabel, 'No project selected');
  assert.equal(context.localPathLabel, 'Client workspace not linked');
  assert.equal(context.targetLabel, 'No target selected');
});
