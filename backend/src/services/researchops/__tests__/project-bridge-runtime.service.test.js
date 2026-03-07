'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildProjectBridgeRuntime } = require('../project-bridge-runtime.service');
const {
  loadProjectBridgeRuntimeForProject,
  loadProjectBridgeRuntimeForRun,
} = require('../project-bridge-runtime.service');

test('buildProjectBridgeRuntime derives bridge readiness for client agent projects', () => {
  const runtime = buildProjectBridgeRuntime({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  }, {
    id: 'srv_client_1',
    supportedTaskTypes: [
      'project.checkPath',
      'project.ensurePath',
      'project.ensureGit',
      'bridge.fetchNodeContext',
      'bridge.fetchContextPack',
      'bridge.submitNodeRun',
    ],
  });

  assert.equal(runtime.executionTarget, 'client-daemon');
  assert.equal(runtime.serverId, 'srv_client_1');
  assert.equal(runtime.supportsLocalBridgeWorkflow, false);
  assert.deepEqual(runtime.missingBridgeTaskTypes, [
    'bridge.fetchRunReport',
    'bridge.submitRunNote',
  ]);
});

test('loadProjectBridgeRuntimeForProject resolves device-backed bridge runtime', async () => {
  const runtime = await loadProjectBridgeRuntimeForProject({
    userId: 'czk',
    project: {
      id: 'proj_1',
      locationType: 'client',
      clientMode: 'agent',
      clientDeviceId: 'srv_client_1',
    },
    store: {
      listDaemons: async () => [{
        id: 'srv_client_1',
        supportedTaskTypes: [
          'project.checkPath',
          'project.ensurePath',
          'project.ensureGit',
          'bridge.fetchNodeContext',
          'bridge.fetchContextPack',
          'bridge.submitNodeRun',
          'bridge.fetchRunReport',
          'bridge.submitRunNote',
        ],
      }],
    },
  });

  assert.equal(runtime.executionTarget, 'client-daemon');
  assert.equal(runtime.serverId, 'srv_client_1');
  assert.equal(runtime.supportsLocalBridgeWorkflow, true);
});

test('loadProjectBridgeRuntimeForRun loads the project before deriving bridge runtime', async () => {
  const calls = [];
  const runtime = await loadProjectBridgeRuntimeForRun({
    userId: 'czk',
    run: {
      id: 'run_123',
      projectId: 'proj_1',
    },
    store: {
      getProject: async (userId, projectId) => {
        calls.push(['getProject', userId, projectId]);
        return {
          id: 'proj_1',
          locationType: 'client',
          clientMode: 'agent',
          clientDeviceId: 'srv_client_1',
        };
      },
      listDaemons: async () => [{
        id: 'srv_client_1',
        supportedTaskTypes: [
          'project.checkPath',
          'project.ensurePath',
          'project.ensureGit',
          'bridge.fetchNodeContext',
          'bridge.fetchContextPack',
          'bridge.submitNodeRun',
          'bridge.fetchRunReport',
          'bridge.submitRunNote',
        ],
      }],
    },
  });

  assert.deepEqual(calls, [['getProject', 'czk', 'proj_1']]);
  assert.equal(runtime.executionTarget, 'client-daemon');
  assert.equal(runtime.serverId, 'srv_client_1');
});
