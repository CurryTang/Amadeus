'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../store');

test('registerDaemon persists supported task types and task catalog version', async () => {
  const daemon = await store.registerDaemon('daemon_caps_user', {
    hostname: 'client-host',
    status: 'ONLINE',
    supportedTaskTypes: [
      'project.checkPath',
      'bridge.fetchNodeContext',
    ],
    taskCatalogVersion: 'v0',
  });

  assert.deepEqual(daemon.supportedTaskTypes, [
    'project.checkPath',
    'bridge.fetchNodeContext',
  ]);
  assert.equal(daemon.taskCatalogVersion, 'v0');
});

test('heartbeatDaemon updates supported task types for an existing daemon', async () => {
  const registered = await store.registerDaemon('daemon_caps_user_hb', {
    hostname: 'client-host-2',
    status: 'ONLINE',
    supportedTaskTypes: ['project.checkPath'],
    taskCatalogVersion: 'v0',
  });

  const daemon = await store.heartbeatDaemon('daemon_caps_user_hb', {
    serverId: registered.id,
    status: 'ONLINE',
    supportedTaskTypes: [
      'project.checkPath',
      'bridge.fetchRunReport',
    ],
    taskCatalogVersion: 'v0',
  });

  assert.deepEqual(daemon.supportedTaskTypes, [
    'project.checkPath',
    'bridge.fetchRunReport',
  ]);
  assert.equal(daemon.taskCatalogVersion, 'v0');
});
