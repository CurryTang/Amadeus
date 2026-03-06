'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertProjectExecutionAllowed } = require('../project-location.service');

test('rejects browser client projects for git-managed execution', () => {
  assert.throws(() => assertProjectExecutionAllowed({
    locationType: 'client',
    clientMode: 'browser',
  }, 'git-managed execution'), /Browser-backed client projects do not support git-managed execution/i);
});

test('allows agent client projects for execution', () => {
  assert.doesNotThrow(() => assertProjectExecutionAllowed({
    locationType: 'client',
    clientMode: 'agent',
    clientDeviceId: 'srv_client_1',
  }, 'run execution'));
});
