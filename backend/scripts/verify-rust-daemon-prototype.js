#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');

const {
  BUILT_IN_DAEMON_TASK_TYPES,
  OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
} = require('../src/services/researchops/daemon-task-descriptor.service');
const { normalizeDaemon } = require('../src/services/researchops/daemon-payload.service');

function readRustTaskCatalog() {
  const cargoManifestPath = path.join(__dirname, '..', 'rust', 'researchops-local-daemon', 'Cargo.toml');
  const stdout = execFileSync('cargo', ['run', '--manifest-path', cargoManifestPath, '--quiet', '--', '--task-catalog'], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
    },
  });
  return JSON.parse(stdout);
}

function readJsTaskCatalog() {
  const daemon = normalizeDaemon({
    id: 'srv_contract_check',
    status: 'ONLINE',
    supportedTaskTypes: [
      ...BUILT_IN_DAEMON_TASK_TYPES,
      ...OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
    ],
    taskCatalogVersion: 'v0',
  });
  return {
    version: daemon.capabilities.taskCatalogVersion,
    tasks: daemon.capabilities.taskDescriptors.map((item) => ({
      task_type: item.taskType,
      family: item.family,
      handler_mode: item.handlerMode,
      summary: item.summary,
    })),
  };
}

function sortCatalogTasks(tasks = []) {
  return [...tasks].sort((left, right) => String(left.task_type).localeCompare(String(right.task_type)));
}

function main() {
  const rustCatalog = readRustTaskCatalog();
  const jsCatalog = readJsTaskCatalog();

  assert.equal(rustCatalog.version, jsCatalog.version, 'task catalog version mismatch');
  assert.deepEqual(
    sortCatalogTasks(rustCatalog.tasks),
    sortCatalogTasks(jsCatalog.tasks),
    'rust task catalog drifted from JS daemon catalog',
  );

  process.stdout.write('rust daemon prototype contract ok\n');
}

main();
