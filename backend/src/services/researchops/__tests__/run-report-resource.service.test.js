'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadRunReportInlineData,
  loadRunReportResources,
} = require('../run-report-resource.service');

test('loadRunReportResources fetches run, steps, artifacts, and checkpoints from the store', async () => {
  const calls = [];
  const store = {
    async getRun(userId, runId) {
      calls.push(['getRun', userId, runId]);
      return { id: runId };
    },
    async listRunSteps(userId, runId) {
      calls.push(['listRunSteps', userId, runId]);
      return [{ id: 'step_1' }];
    },
    async listRunArtifacts(userId, runId, options) {
      calls.push(['listRunArtifacts', userId, runId, options.limit]);
      return [{ id: 'art_1' }];
    },
    async listRunCheckpoints(userId, runId, options) {
      calls.push(['listRunCheckpoints', userId, runId, options.limit]);
      return [{ id: 'cp_1' }];
    },
  };

  const payload = await loadRunReportResources({
    userId: 'u_1',
    runId: 'run_1',
    store,
  });

  assert.equal(payload.run.id, 'run_1');
  assert.equal(payload.steps.length, 1);
  assert.equal(payload.artifacts.length, 1);
  assert.equal(payload.checkpoints.length, 1);
  assert.deepEqual(calls, [
    ['getRun', 'u_1', 'run_1'],
    ['listRunSteps', 'u_1', 'run_1'],
    ['listRunArtifacts', 'u_1', 'run_1', 1000],
    ['listRunCheckpoints', 'u_1', 'run_1', 500],
  ]);
});

test('loadRunReportInlineData reads inline previews and parses manifest json', async () => {
  const payload = await loadRunReportInlineData({
    includeInline: true,
    artifacts: [
      {
        id: 'art_summary',
        kind: 'run_summary_md',
        metadata: {
          inlinePreview: '# Summary',
        },
      },
      {
        id: 'art_manifest',
        kind: 'result_manifest',
        metadata: {
          inlinePreview: '{"summary":{"deliverableCount":2}}',
        },
      },
    ],
  });

  assert.equal(payload.summaryText, '# Summary');
  assert.deepEqual(payload.manifest, {
    summary: {
      deliverableCount: 2,
    },
  });
});

test('loadRunReportInlineData prefers object storage content when object keys exist', async () => {
  const payload = await loadRunReportInlineData({
    includeInline: true,
    artifacts: [
      {
        id: 'art_summary',
        kind: 'run_summary_md',
        objectKey: 'summary-key',
      },
      {
        id: 'art_manifest',
        kind: 'result_manifest',
        objectKey: 'manifest-key',
      },
    ],
    downloadBuffer: async (objectKey) => {
      if (objectKey === 'summary-key') return Buffer.from('downloaded summary');
      if (objectKey === 'manifest-key') return Buffer.from('{"summary":{"figureCount":1}}');
      return null;
    },
  });

  assert.equal(payload.summaryText, 'downloaded summary');
  assert.deepEqual(payload.manifest, {
    summary: {
      figureCount: 1,
    },
  });
});
