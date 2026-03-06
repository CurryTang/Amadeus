'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  deriveRunWorkspacePath,
  findRunReportHighlights,
} = require('../run-report-view');

test('deriveRunWorkspacePath prefers explicit metadata path', () => {
  const workspacePath = deriveRunWorkspacePath({
    id: 'run_123',
    metadata: {
      runWorkspacePath: '/tmp/researchops-runs/run_123',
    },
  }, {
    runtimeFiles: {
      rootDir: '/tmp/other',
    },
    stepResults: [],
  });

  assert.equal(workspacePath, '/tmp/researchops-runs/run_123');
});

test('deriveRunWorkspacePath falls back to remote tmpdir for ssh-backed steps', () => {
  const workspacePath = deriveRunWorkspacePath({
    id: 'run_ssh',
    metadata: {},
  }, {
    runtimeFiles: {
      rootDir: '/tmp/researchops-runs/run_ssh',
    },
    stepResults: [
      {
        metrics: {
          execServerId: 'chatdse',
        },
      },
    ],
  });

  assert.equal(workspacePath, '/tmp/researchops-runs/run_ssh');
});

test('findRunReportHighlights returns summary and final output artifact ids', () => {
  const highlights = findRunReportHighlights([
    { id: 'art_summary', kind: 'run_summary_md' },
    { id: 'art_final', kind: 'agent_final_json' },
    { id: 'art_deliverable', kind: 'deliverable_report' },
    { id: 'art_plot', kind: 'plot' },
  ]);

  assert.deepEqual(highlights, {
    summaryArtifactId: 'art_summary',
    finalOutputArtifactId: 'art_final',
    deliverableArtifactIds: ['art_summary', 'art_final', 'art_deliverable'],
  });
});
