'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const researchOpsRouter = require('../../researchops');

test('buildTreeRunMetadata disables git-managed worktrees for jumpstart setup nodes', () => {
  const metadata = researchOpsRouter.buildTreeRunMetadata({
    project: {
      projectPath: '/egr/research-dselab/testuser/autobench',
    },
    node: {
      id: 'project_environment',
      title: 'Bootstrap Environment from Project Intent',
      kind: 'setup',
      git: {
        base: 'HEAD',
      },
    },
    runSource: 'jumpstart',
    commands: ['pixi install'],
  });

  assert.equal(metadata.cwd, '/egr/research-dselab/testuser/autobench');
  assert.equal(metadata.gitManaged, false);
  assert.equal(metadata.treeNodeTitle, 'Bootstrap Environment from Project Intent');
});

test('buildTreeRunMetadata keeps git-managed execution for non-setup tree runs', () => {
  const metadata = researchOpsRouter.buildTreeRunMetadata({
    project: {
      projectPath: '/egr/research-dselab/testuser/autobench',
    },
    node: {
      id: 'baseline_root',
      title: 'Baseline Root',
      kind: 'knowledge',
      git: {
        base: 'HEAD',
      },
    },
    runSource: 'run-step',
    commands: ['echo ready'],
  });

  assert.equal(metadata.gitManaged, true);
});
