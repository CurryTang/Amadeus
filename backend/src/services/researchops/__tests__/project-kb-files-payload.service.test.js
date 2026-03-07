'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectKbFilesPayload } = require('../project-kb-files-payload.service');

test('buildProjectKbFilesPayload preserves listing roots and adds kb file actions', () => {
  const payload = buildProjectKbFilesPayload({
    projectId: 'proj_1',
    kbFolderPath: '/repo/resource',
    listing: {
      rootPath: '/repo/resource',
      items: [{ path: 'paper_1/paper.pdf', type: 'file' }],
      totalFiles: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
    },
    refreshedAt: '2026-03-06T12:00:00.000Z',
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.kbFolderPath, '/repo/resource');
  assert.equal(payload.rootPath, '/repo/resource');
  assert.equal(payload.items[0].path, 'paper_1/paper.pdf');
  assert.equal(payload.totalFiles, 1);
  assert.equal(payload.refreshedAt, '2026-03-06T12:00:00.000Z');
  assert.deepEqual(payload.actions.listKbFiles, {
    method: 'GET',
    path: '/researchops/projects/proj_1/kb/files',
  });
  assert.deepEqual(payload.actions.listKbTree, {
    method: 'GET',
    path: '/researchops/projects/proj_1/files/tree?scope=kb',
  });
});

test('buildProjectKbFilesPayload handles missing folder paths by keeping empty roots', () => {
  const payload = buildProjectKbFilesPayload({
    projectId: 'proj_1',
    kbFolderPath: '',
    listing: {
      rootPath: '',
      items: [],
      totalFiles: 0,
      offset: 0,
      limit: 3,
      hasMore: false,
    },
  });

  assert.equal(payload.kbFolderPath, null);
  assert.equal(payload.rootPath, null);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.totalFiles, 0);
});
