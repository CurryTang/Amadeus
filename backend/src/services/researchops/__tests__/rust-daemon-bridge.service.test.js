'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  fetchNodeBridgeContextViaRustDaemon,
  fetchRunBridgeReportViaRustDaemon,
  submitNodeBridgeRunViaRustDaemon,
  submitRunBridgeNoteViaRustDaemon,
} = require('../rust-daemon-bridge.service');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) reject(error);
      else resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test('rust daemon bridge helpers execute typed task requests over configured http transport', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      res.end(JSON.stringify({ ok: true, taskType: JSON.parse(body || '{}').taskType || null }));
    });
  });
  const port = await listen(server);
  const env = {
    RESEARCHOPS_RUST_DAEMON_URL: `http://127.0.0.1:${port}`,
  };

  try {
    const report = await fetchRunBridgeReportViaRustDaemon({ runId: 'run_1', env });
    const note = await submitRunBridgeNoteViaRustDaemon({
      runId: 'run_1',
      title: 'Note',
      content: 'hello',
      env,
    });
    const context = await fetchNodeBridgeContextViaRustDaemon({
      projectId: 'proj_1',
      nodeId: 'node_eval',
      includeContextPack: true,
      includeReport: true,
      env,
    });

    assert.equal(report.taskType, 'bridge.fetchRunReport');
    assert.equal(note.taskType, 'bridge.submitRunNote');
    assert.equal(context.taskType, 'bridge.fetchNodeContext');
    assert.deepEqual(requests.map((item) => item.body?.taskType), [
      'bridge.fetchRunReport',
      'bridge.submitRunNote',
      'bridge.fetchNodeContext',
    ]);
    assert.equal(requests[2].body.payload.includeContextPack, true);
    assert.equal(requests[2].body.payload.includeReport, true);
  } finally {
    await close(server);
  }
});

test('submitNodeBridgeRunViaRustDaemon forwards executor request metadata and normalizes executor results', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, {
        'Content-Type': 'application/json',
        Connection: 'close',
      });
      res.end(JSON.stringify({
        mode: 'run',
        run: {
          id: 'run_exec_1',
          projectId: 'proj_1',
          status: 'QUEUED',
          metadata: {
            treeNodeId: 'node_eval',
            jobSpec: {
              backend: 'container',
              runtimeClass: 'container-fast',
            },
          },
        },
        executionResult: {
          executionId: ' exec_123 ',
          status: 'SUCCEEDED',
          exitCode: '0',
          artifacts: [
            {
              id: ' artifact_metrics ',
              kind: 'metrics_json',
              path: ' /tmp/run/metrics.json ',
            },
          ],
          metrics: {
            durationMs: '1532',
          },
          logDigest: {
            lineCount: '42',
          },
          failureSummary: {
            code: ' EXIT_NONZERO ',
            message: ' command failed ',
            retryable: 1,
          },
        },
      }));
    });
  });
  const port = await listen(server);
  const env = {
    RESEARCHOPS_RUST_DAEMON_URL: `http://127.0.0.1:${port}`,
  };

  try {
    const result = await submitNodeBridgeRunViaRustDaemon({
      projectId: 'proj_1',
      nodeId: 'node_eval',
      workspaceSnapshot: {
        path: '/tmp/workspace',
      },
      executionRequest: {
        runId: 'run_exec_1',
        projectId: 'proj_1',
        jobSpec: {
          backend: 'container',
          runtimeClass: 'container-fast',
        },
        outputContract: {
          requiredArtifacts: ['metrics'],
        },
      },
      env,
    });

    assert.equal(requests[0].body.taskType, 'bridge.submitNodeRun');
    assert.deepEqual(requests[0].body.payload.executionRequest, {
      runId: 'run_exec_1',
      projectId: 'proj_1',
      jobSpec: {
        backend: 'container',
        runtimeClass: 'container-fast',
      },
      outputContract: {
        requiredArtifacts: ['metrics'],
      },
    });
    assert.deepEqual(result.executionResult, {
      executionId: 'exec_123',
      status: 'succeeded',
      exitCode: 0,
      artifacts: [
        {
          id: 'artifact_metrics',
          kind: 'metrics_json',
          path: '/tmp/run/metrics.json',
        },
      ],
      metrics: {
        durationMs: 1532,
      },
      logDigest: {
        lineCount: 42,
      },
      failureSummary: {
        code: 'EXIT_NONZERO',
        message: 'command failed',
        retryable: true,
      },
    });
  } finally {
    await close(server);
  }
});
