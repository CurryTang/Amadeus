function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function filterOnlineClientDevices(items = []) {
  return (Array.isArray(items) ? items : []).filter(
    (item) => cleanString(item?.status).toUpperCase() === 'ONLINE'
  );
}

function buildClientDeviceOption(device = {}) {
  const id = cleanString(device?.id);
  const hostname = cleanString(device?.hostname) || id;
  const status = cleanString(device?.status).toUpperCase() || 'UNKNOWN';
  const location = cleanString(device?.execution?.location).toLowerCase();
  const bridgeReady = device?.capabilities?.supportsLocalBridgeWorkflow === true;
  const parts = [status];
  if (location) parts.push(location);
  if (bridgeReady) parts.push('bridge ready');
  return {
    value: id,
    label: `${hostname} (${parts.join(' · ')})`,
  };
}

function buildRustDaemonStatusNote(health = null) {
  const rustDaemon = health && typeof health === 'object' ? health.rustDaemon : null;
  if (!rustDaemon || typeof rustDaemon !== 'object') return '';
  if (rustDaemon.enabled !== true) return '';
  const transport = cleanString(rustDaemon.transport) || 'unknown';
  if (cleanString(rustDaemon.status).toLowerCase() === 'ok') {
    const runtime = rustDaemon.runtime && typeof rustDaemon.runtime === 'object' ? rustDaemon.runtime : {};
    const parts = [];
    const catalogVersion = cleanString(runtime.task_catalog_version);
    if (catalogVersion) parts.push(`catalog ${catalogVersion}`);
    if (runtime.supports_local_bridge_workflow === true) parts.push('bridge ready');
    return `Rust daemon ready via ${transport}${parts.length ? ` (${parts.join(' · ')})` : ''}.`;
  }
  if (cleanString(rustDaemon.status).toLowerCase() === 'error') {
    const message = cleanString(rustDaemon.error) || 'unknown error';
    return `Rust daemon probe failed via ${transport}: ${message}.`;
  }
  return `Rust daemon status: ${cleanString(rustDaemon.status) || 'unknown'}.`;
}

function buildBootstrapRuntimeCommands(bootstrap = null) {
  const runtimeOptions = bootstrap && typeof bootstrap === 'object' ? bootstrap.runtimeOptions : null;
  const rustPrototype = runtimeOptions && typeof runtimeOptions === 'object'
    ? runtimeOptions.rustDaemonPrototype
    : null;
  const commands = rustPrototype && typeof rustPrototype === 'object' ? rustPrototype.commands : null;
  const items = [];
  const httpCommand = cleanString(commands?.http);
  const unixCommand = cleanString(commands?.unix);
  if (httpCommand) {
    items.push({
      key: 'rust-http',
      label: 'Rust daemon (HTTP)',
      command: httpCommand,
    });
  }
  if (unixCommand) {
    items.push({
      key: 'rust-unix',
      label: 'Rust daemon (Unix socket)',
      command: unixCommand,
    });
  }
  return items;
}

function buildBootstrapRuntimeEnvFiles(bootstrap = null) {
  const runtimeOptions = bootstrap && typeof bootstrap === 'object' ? bootstrap.runtimeOptions : null;
  const rustPrototype = runtimeOptions && typeof runtimeOptions === 'object'
    ? runtimeOptions.rustDaemonPrototype
    : null;
  const envFiles = rustPrototype && typeof rustPrototype === 'object' ? rustPrototype.envFiles : null;
  const items = [];
  const httpFile = envFiles && typeof envFiles === 'object' ? envFiles.http : null;
  const unixFile = envFiles && typeof envFiles === 'object' ? envFiles.unix : null;
  const httpFilename = cleanString(httpFile?.filename);
  const httpContent = cleanString(httpFile?.content);
  const unixFilename = cleanString(unixFile?.filename);
  const unixContent = cleanString(unixFile?.content);
  if (httpFilename && httpContent) {
    items.push({
      key: 'rust-env-http',
      label: 'Rust env (HTTP)',
      filename: httpFilename,
      content: httpContent,
    });
  }
  if (unixFilename && unixContent) {
    items.push({
      key: 'rust-env-unix',
      label: 'Rust env (Unix socket)',
      filename: unixFilename,
      content: unixContent,
    });
  }
  return items;
}

export {
  buildBootstrapRuntimeCommands,
  buildBootstrapRuntimeEnvFiles,
  buildClientDeviceOption,
  buildRustDaemonStatusNote,
  filterOnlineClientDevices,
};
