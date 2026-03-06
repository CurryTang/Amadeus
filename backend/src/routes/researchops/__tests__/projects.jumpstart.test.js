'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

function buildPlaceholderPlan() {
  return {
    version: 1,
    project: 'Demo',
    vars: {},
    nodes: [
      {
        id: 'init',
        title: 'Project bootstrap',
        kind: 'setup',
        assumption: ['Project path is accessible'],
        target: ['Repository and environment baseline verified'],
        commands: [],
        checks: [],
      },
    ],
  };
}

test('inferProjectModeFromPathCheck treats existing directories as existing codebases', () => {
  const result = projectsRouter.inferProjectModeFromPathCheck({
    exists: true,
    isDirectory: true,
  });

  assert.equal(result, 'existing_codebase');
});

test('inferProjectModeFromPathCheck treats missing paths as new projects', () => {
  const result = projectsRouter.inferProjectModeFromPathCheck({
    exists: false,
    isDirectory: false,
  });

  assert.equal(result, 'new_project');
});

test('buildJumpstartPlan uses the selected template to replace the placeholder with an environment root', () => {
  const result = projectsRouter.buildJumpstartPlan({
    currentPlan: buildPlaceholderPlan(),
    projectMode: 'new_project',
    bootstrapMode: 'template',
    template: {
      id: 'tmpl_pixi',
      name: 'Pixi DS',
      description: 'Bootstrap data science with pixi',
      sourceType: 'pixi',
      fileName: 'pixi.toml',
      fileContent: '[project]\nname = "demo"\n',
      testSpec: {
        pythonImports: ['pandas', 'numpy'],
      },
    },
  });

  assert.equal(result.plan.nodes.length, 1);
  assert.equal(result.plan.nodes[0].id, 'project_environment');
  assert.equal(result.plan.nodes[0].parent, undefined);
  assert.equal(result.plan.nodes[0].kind, 'setup');
  assert.equal(result.plan.nodes[0].ui?.bootstrapMode, 'template');
  assert.equal(result.plan.nodes[0].resources?.template?.sourceType, 'pixi');
  assert.match(result.plan.nodes[0].commands[0].cmd, /pixi\.toml/);
});

test('buildJumpstartPlan generates an environment root from freeform intent', () => {
  const result = projectsRouter.buildJumpstartPlan({
    currentPlan: buildPlaceholderPlan(),
    projectMode: 'new_project',
    bootstrapMode: 'intent',
    freeformIntent: 'Build a Python API with FastAPI and Redis.',
  });

  assert.equal(result.plan.nodes.length, 1);
  assert.equal(result.plan.nodes[0].id, 'project_environment');
  assert.equal(result.plan.nodes[0].ui?.bootstrapMode, 'intent');
  assert.match(result.plan.nodes[0].assumption.join(' '), /FastAPI/i);
});

test('buildJumpstartPlan provisions python and rust runtimes for mixed-language intent', () => {
  const result = projectsRouter.buildJumpstartPlan({
    currentPlan: buildPlaceholderPlan(),
    projectMode: 'new_project',
    bootstrapMode: 'intent',
    freeformIntent: 'a project based on python and rust',
  });

  const environmentNode = result.plan.nodes[0];
  const commandText = environmentNode.commands.map((item) => item.cmd).join('\n');
  const checkText = environmentNode.checks.map((item) => item.condition).join('\n');

  assert.equal(environmentNode.id, 'project_environment');
  assert.match(commandText, /pixi init/);
  assert.match(commandText, /pixi add python=3\.12/);
  assert.match(commandText, /pixi install/);
  assert.match(commandText, /pixi run python --version/);
  assert.match(commandText, /cargo test/);
  assert.match(commandText, /rustup|cargo --version/);
  assert.match(commandText, /\$HOME\/\.cargo\/bin/);
  assert.match(checkText, /cargo test/);
  assert.match(environmentNode.target.join(' '), /Python/i);
  assert.match(environmentNode.target.join(' '), /Rust/i);
});

test('buildJumpstartPlan can create an empty environment root', () => {
  const result = projectsRouter.buildJumpstartPlan({
    currentPlan: buildPlaceholderPlan(),
    projectMode: 'new_project',
    bootstrapMode: 'empty',
  });

  assert.equal(result.plan.nodes.length, 1);
  assert.equal(result.plan.nodes[0].id, 'project_environment');
  assert.equal(result.plan.nodes[0].ui?.bootstrapMode, 'empty');
  assert.match(result.plan.nodes[0].commands.map((item) => item.cmd).join('\n'), /pixi add python=3\.12/);
  assert.match(result.plan.nodes[0].commands.map((item) => item.cmd).join('\n'), /pixi run python --version/);
});

test('buildJumpstartPlan keeps existing-codebase jumpstart on the analysis path', () => {
  const result = projectsRouter.buildJumpstartPlan({
    currentPlan: buildPlaceholderPlan(),
    projectMode: 'existing_codebase',
    bootstrapMode: 'existing_codebase',
  });

  assert.equal(result.plan.nodes.some((node) => node.id === 'baseline_codebase_scan'), true);
  assert.equal(result.plan.nodes.some((node) => node.id === 'project_environment'), false);
});

test('queueJumpstartAutoRun returns queued metadata immediately while execution continues', async () => {
  let resolved = false;
  const { autoRun, completion } = projectsRouter.queueJumpstartAutoRun({
    executeTreeNodeRunFn: async ({ node }) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      resolved = true;
      return { nodeId: node.id };
    },
    args: {
      node: { id: 'project_environment', title: 'Project environment' },
    },
  });

  assert.equal(autoRun.queued, true);
  assert.equal(autoRun.deferred, true);
  assert.equal(autoRun.nodeId, 'project_environment');
  assert.equal(resolved, false);

  await completion;
  assert.equal(resolved, true);
});

test('buildJumpstartQueuedState persists a queued environment root before deferred execution starts', () => {
  const nextState = projectsRouter.buildJumpstartQueuedState({
    treeState: { nodes: {} },
    node: { id: 'project_environment' },
  });

  assert.equal(nextState.nodes.project_environment.status, 'QUEUED');
  assert.equal(nextState.nodes.project_environment.lastRunStatus, 'QUEUED');
  assert.equal(nextState.nodes.project_environment.runSource, 'jumpstart');
});

test('setup tree nodes run without git-managed worktrees', () => {
  assert.equal(
    projectsRouter.shouldUseGitManagedTreeRun({
      node: { id: 'project_environment', kind: 'setup' },
      runSource: 'jumpstart',
    }),
    false
  );
});

test('non-setup tree nodes keep git-managed execution enabled', () => {
  assert.equal(
    projectsRouter.shouldUseGitManagedTreeRun({
      node: { id: 'baseline_codebase_scan', kind: 'knowledge' },
      runSource: 'run-step',
    }),
    true
  );
});

test('extractNodeCommands keeps command objects that use the cmd field', () => {
  const commands = projectsRouter.extractNodeCommands({
    commands: [
      { cmd: 'python -m venv .venv', label: 'Create virtual environment' },
      { cmd: 'cargo test', label: 'Run Rust feasibility test' },
    ],
  });

  assert.deepEqual(commands, [
    'python -m venv .venv',
    'cargo test',
  ]);
});
