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
  assert.deepEqual(result.execution, {
    location: 'client',
    transport: 'daemon-rpc',
    serverId: 'srv_client_1',
    taskType: 'project.checkPath',
  });
  assert.deepEqual(result.actions.ensurePath, {
    transport: 'daemon-rpc',
    serverId: 'srv_client_1',
    taskType: 'project.ensurePath',
  });
  assert.deepEqual(result.actions.ensureGit, {
    transport: 'daemon-rpc',
    serverId: 'srv_client_1',
    taskType: 'project.ensureGit',
  });
});

test('rejects server-side path check for browser client projects', async () => {
  await assert.rejects(() => projectsRouter.buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
  }, {}), /validated in the browser/i);
});

test('rejects client agent path-check when daemon does not advertise the required task', async () => {
  await assert.rejects(() => projectsRouter.buildProjectPathCheckResponse({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  }, {
    getClientDevice: async () => ({
      id: 'srv_client_1',
      status: 'ONLINE',
      supportedTaskTypes: ['project.ensurePath', 'project.ensureGit'],
    }),
    requestDaemonRpc: async () => {
      throw new Error('rpc should not be called');
    },
  }), /does not support required tasks: project\.checkPath/i);
});

test('rejects client agent project bootstrap when daemon misses required ensure tasks', async () => {
  assert.throws(() => projectsRouter.assertClientDaemonSupportsProjectBootstrap({
    id: 'srv_client_1',
    status: 'ONLINE',
    supportedTaskTypes: ['project.ensurePath'],
  }), /does not support required tasks: project\.ensureGit/i);
});
