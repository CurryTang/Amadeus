'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDaemonBootstrapResponse,
  buildDaemonBootstrapStatusPayload,
} = require('../admin');

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

test('bootstrap status payload keeps discovery metadata without leaking install secrets', async () => {
  const response = buildDaemonBootstrapStatusPayload({
    bootstrap: {
      bootstrapId: 'dbt_123',
      status: 'REDEEMED',
      expiresAt: '2026-03-05T18:00:00.000Z',
      redeemedAt: '2026-03-05T17:30:00.000Z',
      redeemedServerId: 'srv_client_1',
      requestedHostname: 'alice-mbp',
    },
  });

  assert.equal(response.bootstrapId, 'dbt_123');
  assert.equal(response.status, 'REDEEMED');
  assert.equal(response.redeemedAt, '2026-03-05T17:30:00.000Z');
  assert.equal(response.redeemedServerId, 'srv_client_1');
  assert.equal(response.secret, undefined);
  assert.equal(response.installCommand, undefined);
  assert.equal(response.bootstrapFile, undefined);
  assert.deepEqual(response.actions.bootstrapStatus, {
    method: 'GET',
    path: '/researchops/daemons/bootstrap/dbt_123',
  });
  assert.deepEqual(response.actions.registerDaemon, {
    method: 'POST',
    path: '/researchops/daemons/register',
  });
});
