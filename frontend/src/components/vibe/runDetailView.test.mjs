import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunDetailContext,
  buildRunDetailPrompt,
  buildRunDetailOutput,
} from './runDetailView.js';

const BASE_RUN = {
  id: 'run_123',
  serverId: 'chatdse',
  status: 'SUCCEEDED',
  metadata: {
    sourceType: 'tree',
    treeNodeTitle: 'Patch branch',
    todoTitle: 'Clean benchmark harness',
    parentRunId: 'run_parent',
    runWorkspacePath: '/tmp/researchops-runs/run_123',
    prompt: 'Patch the benchmark harness and summarize changes.',
  },
};

test('buildRunDetailContext exposes provenance and workspace info', () => {
  const context = buildRunDetailContext(BASE_RUN, {
    runWorkspacePath: '/tmp/researchops-runs/run_123',
  });

  assert.equal(context.sourceLabel, 'Tree');
  assert.equal(context.treeNodeTitle, 'Patch branch');
  assert.equal(context.todoTitle, 'Clean benchmark harness');
  assert.equal(context.parentRunId, 'run_parent');
  assert.equal(context.serverId, 'chatdse');
  assert.equal(context.workspacePath, '/tmp/researchops-runs/run_123');
});

test('buildRunDetailPrompt prefers prompt text and labels it as user prompt', () => {
  const prompt = buildRunDetailPrompt(BASE_RUN);

  assert.equal(prompt.label, 'User Prompt');
  assert.equal(prompt.text, 'Patch the benchmark harness and summarize changes.');
});

test('buildRunDetailOutput surfaces summary, final output artifact, and figures', () => {
  const output = buildRunDetailOutput(BASE_RUN, {
    summary: 'Implementation completed successfully.',
    artifacts: [
      { id: 'art_final', kind: 'agent_final_json', title: 'Final Output', objectUrl: '/final.json' },
      { id: 'art_summary', kind: 'run_summary_md', title: 'Summary', objectUrl: '/summary.md' },
      { id: 'art_plot', kind: 'plot', title: 'Loss Curve', objectUrl: '/plot.png', mimeType: 'image/png' },
    ],
    manifest: {
      figures: [{ id: 'art_plot', title: 'Loss Curve', objectUrl: '/plot.png' }],
      tables: [],
    },
    highlights: {
      deliverableArtifactIds: ['art_summary', 'art_final'],
      finalOutputArtifactId: 'art_final',
    },
  });

  assert.equal(output.summary, 'Implementation completed successfully.');
  assert.equal(output.finalOutputArtifact?.id, 'art_final');
  assert.equal(output.deliverables.length, 1);
  assert.deepEqual(output.deliverableArtifacts.map((item) => item.id), ['art_summary', 'art_final']);
});

test('buildRunDetailContext falls back to attempt metadata when run metadata is sparse', () => {
  const context = buildRunDetailContext({
    id: 'run_sparse',
    serverId: 'chatdse',
    status: 'RUNNING',
    metadata: {
      sourceType: 'tree',
      runWorkspacePath: '',
    },
  }, {
    workspace: {
      path: '/tmp/researchops-runs/run_sparse',
    },
    attempt: {
      treeNodeTitle: 'Recovered Tree Title',
    },
  });

  assert.equal(context.treeNodeTitle, 'Recovered Tree Title');
  assert.equal(context.workspacePath, '/tmp/researchops-runs/run_sparse');
});
