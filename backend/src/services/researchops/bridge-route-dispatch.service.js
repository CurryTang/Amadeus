'use strict';

const {
  assertBridgeDaemonTransportReady,
  assertRustDaemonTransportReady,
  readBridgeTransportMode,
} = require('./bridge-transport.service');

async function dispatchBridgeTransport({
  transport = '',
  bridgeRuntime = null,
  viaDaemon = null,
  viaRust = null,
  viaHttp = null,
  env = process.env,
} = {}) {
  const mode = readBridgeTransportMode(transport);
  if (mode === 'daemon-task') {
    const serverId = assertBridgeDaemonTransportReady(bridgeRuntime);
    return viaDaemon({ serverId });
  }
  if (mode === 'rust-daemon') {
    const rustConfig = assertRustDaemonTransportReady(env);
    return viaRust({ rustConfig });
  }
  return viaHttp();
}

module.exports = {
  dispatchBridgeTransport,
};
