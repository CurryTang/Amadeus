import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARIS_QUICK_ACTIONS,
  buildArisRunCard,
  buildArisWorkspaceContext,
} from './arisWorkspacePresentation.js';

test('ARIS quick actions expose launcher presets without locking input', () => {
  assert.equal(ARIS_QUICK_ACTIONS[0].id, 'literature_review');
  assert.match(ARIS_QUICK_ACTIONS[0].prefillPrompt, /literature|related work/i);
  assert.equal(
    ARIS_QUICK_ACTIONS.map((action) => action.id).join(','),
    [
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
});

test('buildArisRunCard marks WSL-hosted runs distinctly from remote experiment dispatch', () => {
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
  assert.equal(card.runnerLabel, 'WSL: wsl-main');
  assert.equal(card.destinationLabel, 'Compute: gpu-a100-1');
  assert.equal(card.scoreLabel, '5.8/10 · not ready');
});

test('buildArisWorkspaceContext keeps remote-only dataset roots as references', () => {
  const context = buildArisWorkspaceContext({
    project: { id: 'proj_1', name: 'Paper Agent' },
    runner: { name: 'wsl-main', status: 'online' },
    remoteWorkspacePath: '/srv/aris/paper-agent',
    datasetRoot: '/mnt/data/big-dataset',
    downstreamServer: { name: 'gpu-a100-1' },
  });

  assert.equal(context.runnerLabel, 'WSL runner: wsl-main');
  assert.equal(context.workspaceLabel, '/srv/aris/paper-agent');
  assert.equal(context.datasetLabel, 'Remote dataset: /mnt/data/big-dataset');
  assert.equal(context.destinationLabel, 'Experiment target: gpu-a100-1');
});

test('buildArisRunCard handles sparse payloads gracefully', () => {
  const card = buildArisRunCard({
    id: 'run_2',
    status: 'queued',
  });

  assert.equal(card.title, 'ARIS Run');
  assert.equal(card.statusLabel, 'Queued');
  assert.equal(card.runnerLabel, 'WSL runner pending');
  assert.equal(card.destinationLabel, 'No downstream server');
});
