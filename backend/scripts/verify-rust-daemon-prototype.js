#!/usr/bin/env node
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');

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

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForDaemon(url, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`daemon did not become ready: ${url}`);
}

function requestUnixJson(socketPath, requestPath, { method = 'GET', body = null, timeoutMs = 1500 } = {}) {
  return new Promise((resolve, reject) => {
    const bodyText = body ? JSON.stringify(body) : '';
    const request = http.request({
      socketPath,
      path: requestPath,
      method,
      headers: {
        Accept: 'application/json',
        Connection: 'close',
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyText),
        } : {}),
      },
      timeout: timeoutMs,
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          reject(new Error(`unix daemon request failed (${response.statusCode || 0})`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody || '{}'));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => request.destroy(new Error('unix daemon request timeout')));
    request.on('error', reject);
    if (body) {
      request.write(bodyText);
    }
    request.end();
  });
}

async function createMockBackend() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/researchops/runs/run_verify/bridge-report') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      res.end(JSON.stringify({
        bridgeVersion: 'v0',
        runId: 'run_verify',
        ok: true,
      }));
      return;
    }
    res.writeHead(404, {
      'Content-Type': 'application/json',
      Connection: 'close',
    });
    res.end(JSON.stringify({ error: 'not_found', path: req.url }));
  });
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function verifyRustDaemonExecution() {
  const backend = await createMockBackend();
  const port = await findFreePort();
  const cargoManifestPath = path.join(__dirname, '..', 'rust', 'researchops-local-daemon', 'Cargo.toml');
  const daemon = spawn(
    'cargo',
    ['run', '--manifest-path', cargoManifestPath, '--quiet', '--', '--serve', `127.0.0.1:${port}`, '--max-requests', '12'],
    {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
        RESEARCHOPS_API_BASE_URL: backend.baseUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  daemon.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForDaemon(`http://127.0.0.1:${port}/health`);

    const proxyResponse = await fetch(`http://127.0.0.1:${port}/bridge-report?runId=run_verify`);
    assert.equal(proxyResponse.status, 200, 'bridge-report proxy should succeed');
    const proxyJson = await proxyResponse.json();
    assert.equal(proxyJson.runId, 'run_verify');

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'researchops-rust-daemon-'));
    const taskResponse = await fetch(`http://127.0.0.1:${port}/tasks/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType: 'project.checkPath',
        payload: {
          projectPath: tempDir,
        },
      }),
    });
    assert.equal(taskResponse.status, 200, 'task execution endpoint should succeed');
    const taskJson = await taskResponse.json();
    assert.equal(taskJson.exists, true);
    assert.equal(taskJson.isDirectory, true);
  } finally {
    daemon.kill('SIGTERM');
    await new Promise((resolve) => daemon.once('exit', resolve));
    await backend.close();
  }

  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }
}

async function verifyRustUnixDaemonExecution() {
  const socketPath = path.join(os.tmpdir(), `researchops-rust-daemon-${Date.now()}-${process.pid}.sock`);
  const cargoManifestPath = path.join(__dirname, '..', 'rust', 'researchops-local-daemon', 'Cargo.toml');
  const daemon = spawn(
    'cargo',
    ['run', '--manifest-path', cargoManifestPath, '--quiet', '--', '--serve-unix', socketPath, '--max-requests', '6'],
    {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}`,
        RESEARCHOPS_API_BASE_URL: 'http://127.0.0.1:9',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  daemon.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    for (let index = 0; index < 40; index += 1) {
      try {
        await fs.access(socketPath);
        break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'researchops-rust-daemon-unix-'));
    const taskJson = await requestUnixJson(socketPath, '/tasks/execute', {
      method: 'POST',
      body: {
        taskType: 'project.checkPath',
        payload: {
          projectPath: tempDir,
        },
      },
    });
    assert.equal(taskJson.exists, true);
    assert.equal(taskJson.isDirectory, true);
  } finally {
    daemon.kill('SIGTERM');
    await new Promise((resolve) => daemon.once('exit', resolve));
    await fs.rm(socketPath, { force: true }).catch(() => {});
  }

  if (stderr.trim()) {
    throw new Error(stderr.trim());
  }
}

async function main() {
  const rustCatalog = readRustTaskCatalog();
  const jsCatalog = readJsTaskCatalog();

  assert.equal(rustCatalog.version, jsCatalog.version, 'task catalog version mismatch');
  assert.deepEqual(
    sortCatalogTasks(rustCatalog.tasks),
    sortCatalogTasks(jsCatalog.tasks),
    'rust task catalog drifted from JS daemon catalog',
  );

  await verifyRustDaemonExecution();
  await verifyRustUnixDaemonExecution();

  process.stdout.write('rust daemon prototype contract ok\n');
  process.stdout.write('rust daemon prototype proxy ok\n');
  process.stdout.write('rust daemon prototype task execution ok\n');
  process.stdout.write('rust daemon prototype unix task execution ok\n');
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
