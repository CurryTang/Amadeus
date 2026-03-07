import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRunDetailContext,
  buildRunExecutionSummary,
  buildRunSnapshotSummary,
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

test('buildRunExecutionSummary prefers normalized execution view and formats resources', () => {
  const execution = buildRunExecutionSummary({
    ...BASE_RUN,
    mode: 'headless',
    execution: {
      serverId: 'srv_remote_1',
      location: 'remote',
      mode: 'headless',
      backend: 'container',
      runtimeClass: 'container-fast',
      resources: {
        cpu: 4,
        gpu: 1,
        ramGb: 24,
        timeoutMin: 30,
      },
    },
  });

  assert.deepEqual(execution, {
    serverId: 'srv_remote_1',
    location: 'remote',
    mode: 'headless',
    backend: 'container',
    runtimeClass: 'container-fast',
    resourcesLabel: 'cpu 4 · gpu 1 · ram 24GB · timeout 30m',
  });
});

test('buildRunSnapshotSummary exposes workspace and environment snapshot rows when present', () => {
  const summary = buildRunSnapshotSummary({
    execution: {
      backend: 'container',
      runtimeClass: 'container-fast',
    },
  }, {
    workspaceSnapshot: {
      path: '/tmp/researchops-runs/run_123',
      sourceServerId: 'srv_remote_1',
      runSpecArtifactId: 'art_spec',
    },
    envSnapshot: {
      backend: 'container',
      runtimeClass: 'container-fast',
      resources: {
        cpu: 4,
        gpu: 1,
        ramGb: 24,
        timeoutMin: 30,
      },
    },
  });

  assert.deepEqual(summary, [
    { label: 'Workspace Path', value: '/tmp/researchops-runs/run_123' },
    { label: 'Workspace Source', value: 'srv_remote_1' },
    { label: 'Run Spec', value: 'art_spec' },
    { label: 'Env Backend', value: 'container' },
    { label: 'Runtime Class', value: 'container-fast' },
    { label: 'Env Resources', value: 'cpu 4 · gpu 1 · ram 24GB · timeout 30m' },
  ]);
});
