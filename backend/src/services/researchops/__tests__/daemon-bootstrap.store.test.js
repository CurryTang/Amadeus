'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const store = require('../store');

test('creates and redeems a daemon bootstrap token once', async () => {
  const created = await store.createDaemonBootstrapToken('u1', {
    requestedHostname: 'alice-mbp',
    ttlMs: 60_000,
  });

  assert.equal(typeof created.bootstrapId, 'string');
  assert.equal(typeof created.secret, 'string');
  assert.equal(created.status, 'PENDING');

  const redeemed = await store.redeemDaemonBootstrapToken('u1', {
    bootstrapId: created.bootstrapId,
    secret: created.secret,
    serverId: 'srv_client_1',
  });

  assert.equal(redeemed.status, 'REDEEMED');
  assert.equal(redeemed.redeemedServerId, 'srv_client_1');

  await assert.rejects(() => store.redeemDaemonBootstrapToken('u1', {
    bootstrapId: created.bootstrapId,
    secret: created.secret,
    serverId: 'srv_client_2',
  }), /already redeemed/i);
});
