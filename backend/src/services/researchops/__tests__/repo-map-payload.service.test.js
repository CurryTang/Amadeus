'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProjectRepoMapPayload,
} = require('../repo-map-payload.service');

test('buildProjectRepoMapPayload preserves repo-map roots and exposes read/rebuild actions', () => {
  const payload = buildProjectRepoMapPayload({
    projectId: 'proj_1',
    commit: 'abc123',
    force: false,
    result: {
      proxied: false,
      rootPath: '/repo',
      mapPath: '/repo/.cache/repo-map.json',
      summary: { files: 12 },
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.commit, 'abc123');
  assert.equal(payload.force, false);
  assert.equal(payload.rootPath, '/repo');
  assert.equal(payload.mapPath, '/repo/.cache/repo-map.json');
  assert.equal(payload.summary.files, 12);
  assert.deepEqual(payload.actions.read, {
    method: 'GET',
    path: '/researchops/projects/proj_1/context/repo-map',
  });
  assert.deepEqual(payload.actions.rebuild, {
    method: 'POST',
    path: '/researchops/projects/proj_1/context/repo-map/rebuild',
  });
});

test('buildProjectRepoMapPayload defaults empty commit to null and preserves rebuild mode', () => {
  const payload = buildProjectRepoMapPayload({
    projectId: 'proj_1',
    force: true,
    result: {
      proxied: true,
    },
  });

  assert.equal(payload.commit, null);
  assert.equal(payload.force, true);
  assert.equal(payload.proxied, true);
});
