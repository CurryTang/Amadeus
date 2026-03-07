'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeEnqueueRunPayload } = require('../enqueue-run-payload.service');

test('normalizeEnqueueRunPayload preserves existing metadata while hoisting top-level execution hints into metadata.jobSpec', () => {
  const payload = normalizeEnqueueRunPayload({
    projectId: 'proj_1',
    serverId: 'srv_remote_1',
    runType: 'AGENT',
    mode: 'headless',
    workflow: [],
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 4,
      gpu: 1,
      ramGb: 24,
      timeoutMin: 30,
    },
    metadata: {
      prompt: 'Run evaluation',
    },
  });

  assert.equal(payload.projectId, 'proj_1');
  assert.equal(payload.serverId, 'srv_remote_1');
  assert.equal(payload.metadata.prompt, 'Run evaluation');
  assert.deepEqual(payload.metadata.jobSpec, {
    backend: 'container',
    runtimeClass: 'container-fast',
    resources: {
      cpu: 4,
      gpu: 1,
      ramGb: 24,
      timeoutMin: 30,
    },
  });
});

test('normalizeEnqueueRunPayload merges explicit jobSpec with flat fallbacks and normalizes mode', () => {
  const payload = normalizeEnqueueRunPayload({
    projectId: 'proj_2',
    runType: 'AGENT',
    mode: 'interactive',
    jobSpec: {
      backend: 'k8s',
      resources: {
        cpu: 8,
      },
    },
    runtimeClass: 'container-guarded',
    resources: {
      gpu: 2,
    },
  });

  assert.equal(payload.serverId, 'local-default');
  assert.equal(payload.mode, 'interactive');
  assert.deepEqual(payload.metadata.jobSpec, {
    backend: 'k8s',
    runtimeClass: 'container-guarded',
    resources: {
      cpu: 8,
      gpu: 2,
      ramGb: null,
      timeoutMin: null,
    },
  });
});
