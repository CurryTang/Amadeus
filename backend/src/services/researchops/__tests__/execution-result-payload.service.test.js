'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExecutionResultPayload } = require('../execution-result-payload.service');

test('buildExecutionResultPayload normalizes daemon execution result fields', () => {
  const payload = buildExecutionResultPayload({
    result: {
      executionId: ' exec_123 ',
      status: 'SUCCEEDED',
      exitCode: '0',
      artifacts: [
        {
          id: ' artifact_metrics ',
          kind: 'metrics_json',
          path: ' /tmp/run/metrics.json ',
          title: ' Metrics ',
        },
        {
          id: '',
          kind: '',
          path: '',
        },
      ],
      metrics: {
        durationMs: '1532',
        cpuTimeMs: '612',
        peakMemoryMb: '512',
        ignored: 'n/a',
      },
      logDigest: {
        lineCount: '42',
        stdoutBytes: '2048',
        stderrBytes: '64',
        excerpt: ' completed successfully ',
      },
      failureSummary: {
        code: ' EXIT_NONZERO ',
        message: ' command failed ',
        retryable: 1,
      },
    },
  });

  assert.deepEqual(payload, {
    executionId: 'exec_123',
    status: 'succeeded',
    exitCode: 0,
    artifacts: [
      {
        id: 'artifact_metrics',
        kind: 'metrics_json',
        path: '/tmp/run/metrics.json',
        title: 'Metrics',
      },
    ],
    metrics: {
      durationMs: 1532,
      cpuTimeMs: 612,
      peakMemoryMb: 512,
    },
    logDigest: {
      lineCount: 42,
      stdoutBytes: 2048,
      stderrBytes: 64,
      excerpt: 'completed successfully',
    },
    failureSummary: {
      code: 'EXIT_NONZERO',
      message: 'command failed',
      retryable: true,
    },
  });
});
