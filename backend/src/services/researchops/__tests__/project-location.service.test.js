'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeProjectLocationPayload,
  deriveProjectCapabilities,
  buildProjectPayload,
  buildProjectListPayload,
} = require('../project-location.service');

test('normalizes client agent projects with clientDeviceId and path', () => {
  const result = normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
    projectPath: '/Users/alice/my-project',
  });

  assert.equal(result.locationType, 'client');
  assert.equal(result.clientMode, 'agent');
  assert.equal(result.clientDeviceId, 'srv_client_1');
  assert.equal(result.serverId, 'srv_client_1');
  assert.equal(result.projectPath, '/Users/alice/my-project');
});

test('rejects browser client projects that include serverId', () => {
  assert.throws(() => normalizeProjectLocationPayload({
    locationType: 'client',
    clientMode: 'browser',
    clientWorkspaceId: 'cw_123',
    serverId: 'local-default',
  }), /serverId must not be set/i);
});

test('derives browser client capabilities as non-executable', () => {
  const caps = deriveProjectCapabilities({
    locationType: 'client',
    clientMode: 'browser',
  });

  assert.equal(caps.canExecute, false);
  assert.equal(caps.canGitInit, false);
  assert.equal(caps.requiresBrowserWorkspaceLink, true);
});

test('derives client agent capabilities as daemon-backed execution flow', () => {
  const caps = deriveProjectCapabilities({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  });

  assert.equal(caps.canExecute, true);
  assert.equal(caps.executionTarget, 'client-daemon');
  assert.equal(caps.supportsLocalBridgeWorkflow, true);
  assert.deepEqual(caps.daemonTaskTypes, [
    'project.checkPath',
    'project.ensurePath',
    'project.ensureGit',
  ]);
  assert.deepEqual(caps.optionalDaemonTaskTypes, [
    'bridge.fetchNodeContext',
    'bridge.fetchContextPack',
    'bridge.submitNodeRun',
    'bridge.fetchRunReport',
    'bridge.submitRunNote',
  ]);
  assert.equal(caps.daemonTaskCatalogVersion, 'v0');
  assert.equal(
    caps.daemonTaskDescriptors.find((item) => item.taskType === 'bridge.fetchNodeContext')?.handlerMode,
    'custom',
  );
  assert.deepEqual(caps.bridgeRouteTemplates, {
    nodeBridgeContext: '/researchops/projects/{projectId}/tree/nodes/{nodeId}/bridge-context',
    nodeBridgeRun: '/researchops/projects/{projectId}/tree/nodes/{nodeId}/bridge-run',
    runContextPack: '/researchops/runs/{runId}/context-pack',
    runReport: '/researchops/runs/{runId}/report',
    runArtifacts: '/researchops/runs/{runId}/artifacts',
    runBridgeReport: '/researchops/runs/{runId}/bridge-report',
    runBridgeNote: '/researchops/runs/{runId}/bridge-note',
  });
});

test('buildProjectPayload exposes capabilities, location, and follow-up actions', () => {
  const payload = buildProjectPayload({
    project: {
      id: 'proj_1',
      name: 'Auto Research',
      locationType: 'client',
      clientMode: 'agent',
      clientDeviceId: 'srv_client_1',
      projectPath: '/Users/alice/my-project',
    },
    git: {
      mode: 'initialized',
      branch: 'main',
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.project.id, 'proj_1');
  assert.equal(payload.capabilities.executionTarget, 'client-daemon');
  assert.equal(payload.location.locationType, 'client');
  assert.equal(payload.location.clientMode, 'agent');
  assert.equal(payload.location.clientDeviceId, 'srv_client_1');
  assert.equal(payload.location.projectPath, '/Users/alice/my-project');
  assert.deepEqual(payload.actions.detail, {
    method: 'GET',
    path: '/researchops/projects/proj_1',
  });
  assert.deepEqual(payload.actions.agentSessions, {
    method: 'GET',
    path: '/researchops/projects/proj_1/agent-sessions',
  });
  assert.deepEqual(payload.actions.observedSessions, {
    method: 'GET',
    path: '/researchops/projects/proj_1/observed-sessions',
  });
  assert.deepEqual(payload.actions.treePlan, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/plan',
  });
  assert.deepEqual(payload.git, {
    mode: 'initialized',
    branch: 'main',
  });
});

test('buildProjectListPayload keeps project items compatible while adding capabilities', () => {
  const payload = buildProjectListPayload({
    items: [
      {
        id: 'proj_1',
        name: 'Auto Research',
        locationType: 'client',
        clientMode: 'agent',
        clientDeviceId: 'srv_client_1',
        projectPath: '/Users/alice/my-project',
      },
    ],
    limit: 50,
  });

  assert.equal(payload.limit, 50);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'proj_1');
  assert.equal(payload.items[0].name, 'Auto Research');
  assert.equal(payload.items[0].capabilities.executionTarget, 'client-daemon');
  assert.equal(payload.items[0].location.projectPath, '/Users/alice/my-project');
  assert.deepEqual(payload.items[0].actions.detail, {
    method: 'GET',
    path: '/researchops/projects/proj_1',
  });
});
