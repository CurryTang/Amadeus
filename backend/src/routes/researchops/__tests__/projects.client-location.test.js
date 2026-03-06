'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../projects');

test('builds client agent path-check response via daemon target', async () => {
  const result = await projectsRouter.buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  }, {
    getClientDevice: async () => ({ id: 'srv_client_1', status: 'ONLINE' }),
    requestDaemonRpc: async () => ({
      normalizedPath: '/Users/alice/my-project',
      exists: true,
      isDirectory: true,
    }),
  });

  assert.equal(result.locationType, 'client');
  assert.equal(result.clientMode, 'agent');
  assert.equal(result.clientDeviceId, 'srv_client_1');
  assert.equal(result.exists, true);
  assert.equal(result.isDirectory, true);
  assert.equal(result.canCreate, true);
});

test('rejects server-side path check for browser client projects', async () => {
  await assert.rejects(() => projectsRouter.buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
  }, {}), /validated in the browser/i);
});
