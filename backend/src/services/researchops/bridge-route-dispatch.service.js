'use strict';

const {
  assertBridgeDaemonTransportReady,
  assertRustDaemonTransportReady,
  resolveBridgeTransportMode,
} = require('./bridge-transport.service');

function attachResolvedTransport(result, mode) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  return {
    ...result,
    resolvedTransport: result.resolvedTransport || mode,
  };
}

async function dispatchBridgeTransport({
  transport = '',
  bridgeRuntime = null,
  viaDaemon = null,
  viaRust = null,
  viaHttp = null,
  env = process.env,
} = {}) {
  const mode = resolveBridgeTransportMode({ transport, bridgeRuntime, env });
  if (mode === 'daemon-task') {
    const serverId = assertBridgeDaemonTransportReady(bridgeRuntime);
    return attachResolvedTransport(await viaDaemon({ mode, serverId }), mode);
  }
  if (mode === 'rust-daemon') {
    const rustConfig = assertRustDaemonTransportReady(env);
    return attachResolvedTransport(await viaRust({ mode, rustConfig }), mode);
  }
  return attachResolvedTransport(await viaHttp({ mode }), mode);
}

module.exports = {
  dispatchBridgeTransport,
};
