'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  probeRustDaemonRuntime,
} = require('../rust-daemon-runtime.service');

function listen(server, listenArgs) {
  return new Promise((resolve, reject) => {
    server.listen(...listenArgs, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function buildRuntimeBody() {
  return JSON.stringify({
    task_catalog_version: 'v0',
    supported_task_types: ['project.checkPath', 'bridge.fetchRunReport'],
    supports_local_bridge_workflow: false,
    missing_bridge_task_types: ['bridge.fetchNodeContext'],
  });
}

test('probeRustDaemonRuntime returns disabled when no rust daemon env is configured', async () => {
  const result = await probeRustDaemonRuntime({ env: {} });

  assert.equal(result.enabled, false);
  assert.equal(result.status, 'disabled');
  assert.equal(result.transport, null);
  assert.equal(result.runtime, null);
});

test('probeRustDaemonRuntime reads runtime summary over http', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    if (req.url === '/runtime') {
      const body = buildRuntimeBody();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      });
      res.end(body);
      return;
    }
    assert.equal(req.url, '/task-catalog');
    const body = JSON.stringify({
      version: 'v0',
      tasks: [
        { task_type: 'project.checkPath' },
        { task_type: 'project.ensurePath' },
        { task_type: 'project.ensureGit' },
        { task_type: 'bridge.fetchNodeContext' },
        { task_type: 'bridge.fetchContextPack' },
        { task_type: 'bridge.submitNodeRun' },
        { task_type: 'bridge.fetchRunReport' },
        { task_type: 'bridge.submitRunNote' },
      ],
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Connection: 'close',
    });
    res.end(body);
  });
  await listen(server, [0, '127.0.0.1']);
  const { port } = server.address();

  try {
    const result = await probeRustDaemonRuntime({
      env: {
        RESEARCHOPS_RUST_DAEMON_URL: `http://127.0.0.1:${port}`,
      },
      timeoutMs: 1000,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.transport, 'http');
    assert.equal(result.runtime.task_catalog_version, 'v0');
    assert.deepEqual(result.runtime.supported_task_types, ['project.checkPath', 'bridge.fetchRunReport']);
    assert.equal(result.taskCatalog.version, 'v0');
    assert.equal(result.catalogParity.status, 'aligned');
    assert.deepEqual(result.catalogParity.missingTaskTypes, []);
    assert.deepEqual(result.catalogParity.extraTaskTypes, []);
  } finally {
    await close(server);
  }
});

test('probeRustDaemonRuntime reads runtime summary over unix socket', async () => {
  const socketPath = path.join(os.tmpdir(), `researchops-rust-runtime-${Date.now()}-${process.pid}.sock`);
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    if (req.url === '/runtime') {
      const body = buildRuntimeBody();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close',
      });
      res.end(body);
      return;
    }
    assert.equal(req.url, '/task-catalog');
    const body = JSON.stringify({
      version: 'v0',
      tasks: [
        { task_type: 'project.checkPath' },
      ],
    });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      Connection: 'close',
    });
    res.end(body);
  });
  await listen(server, [socketPath]);

  try {
    const result = await probeRustDaemonRuntime({
      env: {
        RESEARCHOPS_RUST_DAEMON_UNIX_SOCKET: socketPath,
      },
      timeoutMs: 1000,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.transport, 'unix');
    assert.equal(result.runtime.task_catalog_version, 'v0');
    assert.equal(result.socketPath, socketPath);
    assert.equal(result.catalogParity.status, 'mismatch');
    assert.deepEqual(result.catalogParity.missingTaskTypes, [
      'bridge.fetchContextPack',
      'bridge.fetchNodeContext',
      'bridge.fetchRunReport',
      'bridge.submitNodeRun',
      'bridge.submitRunNote',
      'project.ensureGit',
      'project.ensurePath',
    ]);
  } finally {
    await close(server);
    fs.rmSync(socketPath, { force: true });
  }
});
