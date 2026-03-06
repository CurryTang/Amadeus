'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunReportPayload } = require('../run-report-payload.service');

test('buildRunReportPayload exposes attempt semantics while staying run-centered', () => {
  const payload = buildRunReportPayload({
    run: {
      id: 'run_123',
      projectId: 'proj_1',
      provider: 'codex',
      runType: 'EXPERIMENT',
      status: 'SUCCEEDED',
      metadata: {
        treeNodeId: 'baseline_root',
        treeNodeTitle: 'Baseline Root',
        runSource: 'run-step',
        runWorkspacePath: '/tmp/researchops-runs/run_123',
      },
    },
    steps: [],
    artifacts: [
      { id: 'art_summary', kind: 'run_summary_md' },
      { id: 'art_final', kind: 'agent_final_json' },
      { id: 'art_report', kind: 'deliverable_report' },
    ],
    checkpoints: [],
    summaryText: 'Execution complete.',
    manifest: null,
  });

  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.id, 'run_123');
  assert.equal(payload.attempt.nodeId, 'baseline_root');
  assert.equal(payload.attempt.treeNodeTitle, 'Baseline Root');
  assert.deepEqual(payload.highlights.deliverableArtifactIds, ['art_summary', 'art_final', 'art_report']);
  assert.equal('bundle' in payload, false);
  assert.equal('reviewQueue' in payload, false);
});
