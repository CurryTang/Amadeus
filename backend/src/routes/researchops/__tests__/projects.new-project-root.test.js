'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('shouldBootstrapCodebaseRoot returns false for new projects', () => {
  const result = projectsRouter.shouldBootstrapCodebaseRoot({
    project: { projectMode: 'new_project' },
    plan: {
      nodes: [
        { id: 'init', kind: 'setup' },
      ],
    },
    bootstrapRoot: true,
    forceRoot: false,
  });

  assert.equal(result, false);
});

test('shouldBootstrapCodebaseRoot returns true for existing codebases with placeholder init', () => {
  const result = projectsRouter.shouldBootstrapCodebaseRoot({
    project: { projectMode: 'existing_codebase' },
    plan: {
      nodes: [
        { id: 'init', kind: 'setup' },
      ],
    },
    bootstrapRoot: true,
    forceRoot: false,
  });

  assert.equal(result, true);
});
