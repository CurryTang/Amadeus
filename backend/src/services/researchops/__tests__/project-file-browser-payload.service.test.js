'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectFileTreePayload,
  buildProjectFileContentPayload,
  buildProjectKbResourceLocatePayload,
} = require('../project-file-browser-payload.service');

test('buildProjectFileTreePayload preserves tree roots and adds file actions', () => {
  const payload = buildProjectFileTreePayload({
    projectId: 'proj_1',
    rootMode: 'kb-folder',
    result: {
      path: 'paper_1',
      items: [{ name: 'paper.pdf', type: 'file' }],
      total: 1,
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.rootMode, 'kb-folder');
  assert.equal(payload.path, 'paper_1');
  assert.equal(payload.items[0].name, 'paper.pdf');
  assert.deepEqual(payload.actions.listTree, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/tree',
  });
  assert.deepEqual(payload.actions.searchFiles, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/search',
  });
});

test('buildProjectFileContentPayload preserves content roots and current file action', () => {
  const payload = buildProjectFileContentPayload({
    projectId: 'proj_1',
    rootMode: 'project-root',
    result: {
      path: 'src/index.js',
      content: 'console.log(1);',
      truncated: false,
    },
    scope: 'project',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.path, 'src/index.js');
  assert.equal(payload.content, 'console.log(1);');
  assert.deepEqual(payload.actions.readFile, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/content?path=src%2Findex.js&scope=project',
  });
});

test('buildProjectKbResourceLocatePayload preserves locate roots and adds KB follow-up actions', () => {
  const payload = buildProjectKbResourceLocatePayload({
    projectId: 'proj_1',
    rootPath: '/repo/resource',
    result: {
      query: 'paper',
      items: [{ path: 'paper_1/notes.md' }],
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.rootMode, 'kb-folder');
  assert.equal(payload.rootPath, '/repo/resource');
  assert.equal(payload.query, 'paper');
  assert.equal(payload.items[0].path, 'paper_1/notes.md');
  assert.deepEqual(payload.actions.locateResources, {
    method: 'GET',
    path: '/researchops/projects/proj_1/kb/resource-locate',
  });
  assert.deepEqual(payload.actions.listKbTree, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/tree?scope=kb',
  });
});
