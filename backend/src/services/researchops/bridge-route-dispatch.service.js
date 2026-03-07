'use strict';

const {
  assertBridgeDaemonTransportReady,
  readBridgeTransportMode,
} = require('./bridge-transport.service');

async function dispatchBridgeTransport({
  transport = '',
  bridgeRuntime = null,
  viaDaemon = null,
  viaHttp = null,
} = {}) {
  if (readBridgeTransportMode(transport) === 'daemon-task') {
    const serverId = assertBridgeDaemonTransportReady(bridgeRuntime);
    return viaDaemon({ serverId });
  }
  return viaHttp();
}

module.exports = {
  dispatchBridgeTransport,
};
