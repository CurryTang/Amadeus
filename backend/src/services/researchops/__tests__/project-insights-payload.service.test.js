'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectWorkspacePayload,
  buildProjectVenvStatusPayload,
  buildProjectVenvSetupPayload,
  buildProjectGitLogPayload,
  buildProjectServerFilesPayload,
  buildProjectChangedFilesPayload,
} = require('../project-insights-payload.service');

test('buildProjectWorkspacePayload preserves batch roots and actions', () => {
  const payload = buildProjectWorkspacePayload({
    projectId: 'proj_1',
    result: {
      projectPath: '/repo',
      gitProgress: { branch: 'main' },
      kbEntries: { items: [] },
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.projectPath, '/repo');
  assert.equal(payload.gitProgress.branch, 'main');
  assert.deepEqual(payload.actions.workspace, {
    method: 'GET',
    path: '/researchops/projects/proj_1/workspace',
  });
});

test('buildProjectVenvStatusPayload preserves status roots and actions', () => {
  const payload = buildProjectVenvStatusPayload({
    projectId: 'proj_1',
    locationType: 'local',
    status: { tool: 'uv', ready: true },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.locationType, 'local');
  assert.equal(payload.status.tool, 'uv');
  assert.deepEqual(payload.actions.status, {
    method: 'GET',
    path: '/researchops/projects/proj_1/venv/status',
  });
});

test('buildProjectVenvSetupPayload preserves setup roots and actions', () => {
  const payload = buildProjectVenvSetupPayload({
    projectId: 'proj_1',
    locationType: 'local',
    configuredTool: 'pixi',
    status: { ready: true },
    message: 'Virtual environment configured with pixi.',
  });

  assert.equal(payload.success, true);
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.configuredTool, 'pixi');
  assert.deepEqual(payload.actions.setup, {
    method: 'POST',
    path: '/researchops/projects/proj_1/venv/setup',
  });
});

test('buildProjectGitLogPayload preserves git roots and actions', () => {
  const payload = buildProjectGitLogPayload({
    projectId: 'proj_1',
    result: {
      projectPath: '/repo',
      commits: [{ sha: 'abc' }],
      proxied: true,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.proxied, true);
  assert.equal(payload.commits[0].sha, 'abc');
  assert.deepEqual(payload.actions.gitLog, {
    method: 'GET',
    path: '/researchops/projects/proj_1/git-log',
  });
});

test('buildProjectServerFilesPayload preserves file summary roots and actions', () => {
  const payload = buildProjectServerFilesPayload({
    projectId: 'proj_1',
    result: {
      sample: ['a.py'],
      proxied: false,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.sample[0], 'a.py');
  assert.deepEqual(payload.actions.serverFiles, {
    method: 'GET',
    path: '/researchops/projects/proj_1/server-files',
  });
});

test('buildProjectChangedFilesPayload preserves changed file roots and actions', () => {
  const payload = buildProjectChangedFilesPayload({
    projectId: 'proj_1',
    result: {
      files: [{ path: 'src/a.js' }],
      proxied: false,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.files[0].path, 'src/a.js');
  assert.deepEqual(payload.actions.changedFiles, {
    method: 'GET',
    path: '/researchops/projects/proj_1/changed-files',
  });
});
