'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createDaemonBootstrapResponse } = require('../admin');

test('bootstrap create route returns token metadata and install payload', async () => {
  const response = createDaemonBootstrapResponse({
    bootstrap: {
      bootstrapId: 'dbt_123',
      secret: 'secret-value',
      expiresAt: '2026-03-05T18:00:00.000Z',
    },
    apiBaseUrl: 'https://example.com/api',
    requestedHostname: 'alice-mbp',
  });

  assert.equal(response.bootstrapId, 'dbt_123');
  assert.equal(response.secret, 'secret-value');
  assert.equal(response.apiBaseUrl, 'https://example.com/api');
  assert.match(response.installCommand, /RESEARCHOPS_BOOTSTRAP_SECRET='secret-value'/);
  assert.equal(response.bootstrapFile.bootstrapId, 'dbt_123');
  assert.deepEqual(response.actions.bootstrapStatus, {
    method: 'GET',
    path: '/researchops/daemons/bootstrap/dbt_123',
  });
  assert.deepEqual(response.actions.registerDaemon, {
    method: 'POST',
    path: '/researchops/daemons/register',
  });
  assert.deepEqual(response.submitHints.registerDaemon.body, {
    hostname: 'string',
    status: 'string',
    labels: 'object',
    bootstrapId: 'string',
    bootstrapSecret: 'string',
  });
});
