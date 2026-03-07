'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeDaemonTaskRequest } = require('../bridge-daemon-task-request.service');

test('buildBridgeDaemonTaskRequest maps fetchNodeContext payload to a bridge-context request', () => {
  const request = buildBridgeDaemonTaskRequest('bridge.fetchNodeContext', {
    projectId: 'proj_1',
    nodeId: 'node_eval',
    includeContextPack: true,
    includeReport: true,
  });

  assert.deepEqual(request, {
    method: 'GET',
    path: '/researchops/projects/proj_1/tree/nodes/node_eval/bridge-context',
    query: {
      includeContextPack: true,
      includeReport: true,
    },
  });
});

test('buildBridgeDaemonTaskRequest maps submitNodeRun payload to a bridge-run request', () => {
  const request = buildBridgeDaemonTaskRequest('bridge.submitNodeRun', {
    projectId: 'proj_1',
    nodeId: 'node_eval',
    force: true,
    clarifyMessages: [{ role: 'user', content: 'please continue' }],
    localSnapshot: {
      kind: 'workspace_patch',
      note: 'staged locally',
    },
  });

  assert.deepEqual(request, {
    method: 'POST',
    path: '/researchops/projects/proj_1/tree/nodes/node_eval/bridge-run',
    body: {
      force: true,
      clarifyMessages: [{ role: 'user', content: 'please continue' }],
      localSnapshot: {
        kind: 'workspace_patch',
        note: 'staged locally',
      },
    },
  });
});
