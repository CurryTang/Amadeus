'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUILT_IN_DAEMON_TASK_TYPES,
  OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  DAEMON_TASK_CATALOG_VERSION,
  buildDaemonTaskDescriptor,
  listDaemonTaskDescriptors,
  daemonSupportsTaskTypes,
} = require('../daemon-task-descriptor.service');

test('buildDaemonTaskDescriptor returns the current built-in project task contract', () => {
  const descriptor = buildDaemonTaskDescriptor('project.checkPath');

  assert.equal(descriptor.taskType, 'project.checkPath');
  assert.equal(descriptor.family, 'project');
  assert.equal(descriptor.builtIn, true);
  assert.equal(descriptor.handlerMode, 'builtin');
  assert.deepEqual(descriptor.payloadShape, {
    projectPath: 'string',
  });
  assert.deepEqual(descriptor.resultShape, {
    exists: 'boolean',
    isDirectory: 'boolean',
    normalizedPath: 'string',
  });
});

test('buildDaemonTaskDescriptor returns the optional bridge task contract', () => {
  const descriptor = buildDaemonTaskDescriptor('bridge.submitNodeRun');

  assert.equal(descriptor.taskType, 'bridge.submitNodeRun');
  assert.equal(descriptor.family, 'bridge');
  assert.equal(descriptor.builtIn, false);
  assert.equal(descriptor.handlerMode, 'custom');
  assert.deepEqual(descriptor.payloadShape, {
    projectId: 'string',
    nodeId: 'string',
    force: 'boolean?',
    preflightOnly: 'boolean?',
    searchTrialCount: 'number?',
    clarifyMessages: 'array?',
    workspaceSnapshot: 'object?',
    localSnapshot: 'object?',
  });
});

test('listDaemonTaskDescriptors exposes built-in and optional bridge task types under one catalog version', () => {
  const descriptors = listDaemonTaskDescriptors();
  const taskTypes = descriptors.map((item) => item.taskType);

  assert.equal(DAEMON_TASK_CATALOG_VERSION, 'v0');
  assert.deepEqual(BUILT_IN_DAEMON_TASK_TYPES, [
    'project.checkPath',
    'project.ensurePath',
    'project.ensureGit',
  ]);
  assert.deepEqual(OPTIONAL_BRIDGE_DAEMON_TASK_TYPES, [
    'bridge.fetchNodeContext',
    'bridge.fetchContextPack',
    'bridge.submitNodeRun',
    'bridge.fetchRunReport',
    'bridge.submitRunNote',
  ]);
  assert.ok(taskTypes.includes('project.checkPath'));
  assert.ok(taskTypes.includes('bridge.fetchRunReport'));
});

test('daemonSupportsTaskTypes falls back to built-in project tasks and respects advertised support', () => {
  assert.equal(
    daemonSupportsTaskTypes({ supportedTaskTypes: ['project.checkPath'] }, ['project.checkPath']),
    true,
  );
  assert.equal(
    daemonSupportsTaskTypes({ supportedTaskTypes: ['project.checkPath'] }, ['project.ensureGit']),
    false,
  );
  assert.equal(
    daemonSupportsTaskTypes({}, ['project.ensureGit']),
    true,
  );
  assert.equal(
    daemonSupportsTaskTypes({}, ['bridge.fetchRunReport']),
    false,
  );
});
