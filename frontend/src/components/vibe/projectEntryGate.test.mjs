import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOptimisticJumpstartTreeState,
  shouldShowProjectEntryGate,
} from './projectEntryGate.js';

test('shows the gate for new projects without an environment root', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
  }), true);
});

test('hides the gate until the tree workspace has loaded for the selected project', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: null,
    treeState: null,
    treeWorkspaceReady: false,
  }), false);
});

test('hides the gate while the environment root is queued or running', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'project_environment', tags: ['environment_root'] }] },
    treeState: { nodes: { project_environment: { status: 'QUEUED' } } },
  }), false);

  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'project_environment', tags: ['environment_root'] }] },
    treeState: { nodes: { project_environment: { status: 'RUNNING' } } },
  }), false);
});

test('hides the gate after the environment root passes', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'project_environment', tags: ['environment_root'] }] },
    treeState: { nodes: { project_environment: { status: 'PASSED' } } },
  }), false);
});

test('hides the gate after the environment root succeeds', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'project_environment', tags: ['environment_root'] }] },
    treeState: { nodes: { project_environment: { status: 'SUCCEEDED' } } },
  }), false);
});

test('hides the gate when plan already has nodes (project past bootstrap)', () => {
  // Even with a failed environment_root, once the plan has nodes the gate stays hidden
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'project_environment', tags: ['environment_root'] }] },
    treeState: { nodes: { project_environment: { status: 'FAILED' } } },
  }), false);

  // Plan with non-environment nodes (e.g. baseline_root, experiments)
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [{ id: 'baseline_root', tags: ['baseline', 'root'] }, { id: 'init', tags: [] }] },
    treeState: { nodes: {} },
  }), false);
});

test('never shows the gate for existing-codebase projects', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'existing_codebase' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
  }), false);
});

test('hides the gate when environmentDetected is true (no env root in plan)', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    environmentDetected: true,
  }), false);
});

test('still shows the gate when environmentDetected is false', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    environmentDetected: false,
  }), true);
});

test('still shows the gate when environmentDetected is null', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    environmentDetected: null,
  }), true);
});

test('hides the gate when project has TODOs (todoCount > 0)', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    todoCount: 1,
  }), false);

  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    todoCount: 5,
  }), false);
});

test('shows the gate when todoCount is 0', () => {
  assert.equal(shouldShowProjectEntryGate({
    project: { projectMode: 'new_project' },
    plan: { nodes: [] },
    treeState: { nodes: {} },
    todoCount: 0,
  }), true);
});

test('applies optimistic queued state from jumpstart auto-run payload', () => {
  const state = applyOptimisticJumpstartTreeState({
    treeState: { nodes: {} },
    payload: {
      autoRun: { nodeId: 'project_environment', status: 'QUEUED' },
      updatedAt: '2026-03-06T01:00:00.000Z',
    },
  });

  assert.deepEqual(state.nodes.project_environment.status, 'QUEUED');
  assert.equal(state.updatedAt, '2026-03-06T01:00:00.000Z');
});
