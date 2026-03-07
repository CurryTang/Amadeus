'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBridgeTreeRunPayload } = require('../bridge-tree-run-payload.service');

test('buildBridgeTreeRunPayload exposes run semantics for bridge-submitted tree runs', () => {
  const payload = buildBridgeTreeRunPayload({
    projectId: 'proj_1',
    nodeId: 'node_eval',
    result: {
      mode: 'run',
      run: {
        id: 'run_123',
        projectId: 'proj_1',
        serverId: 'srv_remote_1',
        runType: 'EXPERIMENT',
        status: 'QUEUED',
        metadata: {
          treeNodeId: 'node_eval',
          treeNodeTitle: 'Evaluation branch',
          parentRunId: 'run_base',
        },
      },
      blockedBy: [],
      contextPack: {
        generatedAt: '2026-03-06T12:00:00.000Z',
      },
    },
  });

  assert.equal(payload.bridgeVersion, 'v0');
  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.nodeId, 'node_eval');
  assert.equal(payload.mode, 'run');
  assert.equal(payload.run.id, 'run_123');
  assert.equal(payload.attempt.treeNodeId, 'node_eval');
  assert.equal(payload.execution.serverId, 'srv_remote_1');
  assert.equal(payload.followUp.parentRunId, 'run_base');
  assert.deepEqual(payload.contextPack, {
    generatedAt: '2026-03-06T12:00:00.000Z',
  });
});

test('buildBridgeTreeRunPayload preserves preflight preview without fabricating run data', () => {
  const payload = buildBridgeTreeRunPayload({
    projectId: 'proj_1',
    nodeId: 'node_eval',
    result: {
      mode: 'preflight',
      runPayloadPreview: {
        runType: 'EXPERIMENT',
        serverId: 'srv_remote_1',
      },
    },
  });

  assert.equal(payload.mode, 'preflight');
  assert.deepEqual(payload.runPayloadPreview, {
    runType: 'EXPERIMENT',
    serverId: 'srv_remote_1',
  });
  assert.equal('run' in payload, false);
});
