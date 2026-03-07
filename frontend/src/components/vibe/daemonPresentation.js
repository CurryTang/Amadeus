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

function getRustDaemonPayload(input = null) {
  if (!input || typeof input !== 'object') return null;
  if (input.rustDaemon && typeof input.rustDaemon === 'object') return input.rustDaemon;
  return input;
}

function buildRustDaemonStatusNote(health = null) {
  const rustDaemon = getRustDaemonPayload(health);
  if (!rustDaemon || typeof rustDaemon !== 'object') return '';
  if (rustDaemon.enabled !== true) return '';
  const transport = cleanString(rustDaemon.transport) || 'unknown';
  if (cleanString(rustDaemon.status).toLowerCase() === 'ok') {
    const runtime = rustDaemon.runtime && typeof rustDaemon.runtime === 'object' ? rustDaemon.runtime : {};
    const catalogParity = rustDaemon.catalogParity && typeof rustDaemon.catalogParity === 'object'
      ? rustDaemon.catalogParity
      : null;
    const parts = [];
    const catalogVersion = cleanString(runtime.task_catalog_version);
    if (catalogVersion) parts.push(`catalog ${catalogVersion}`);
    if (runtime.supports_local_bridge_workflow === true) parts.push('bridge ready');
    if (cleanString(catalogParity?.status).toLowerCase() === 'mismatch') {
      const missing = Array.isArray(catalogParity?.missingTaskTypes)
        ? catalogParity.missingTaskTypes.map((item) => cleanString(item)).filter(Boolean)
        : [];
      parts.push(`catalog drift${missing.length ? `: ${missing.join(', ')}` : ''}`);
    }
    return `Rust daemon ready via ${transport}${parts.length ? ` (${parts.join(' · ')})` : ''}.`;
  }
  if (cleanString(rustDaemon.status).toLowerCase() === 'error') {
    const message = cleanString(rustDaemon.error) || 'unknown error';
    return `Rust daemon probe failed via ${transport}: ${message}.`;
  }
  return `Rust daemon status: ${cleanString(rustDaemon.status) || 'unknown'}.`;
}

function buildRustDaemonStatusRows(health = null) {
  const rustDaemon = getRustDaemonPayload(health);
  if (!rustDaemon || typeof rustDaemon !== 'object' || rustDaemon.enabled !== true) return [];
  const rows = [];
  const refreshedAt = cleanString(rustDaemon.refreshedAt);
  const transport = cleanString(rustDaemon.transport);
  const endpoint = cleanString(rustDaemon.endpoint);
  const socketPath = cleanString(rustDaemon.socketPath);
  const taskCatalog = rustDaemon.taskCatalog && typeof rustDaemon.taskCatalog === 'object'
    ? rustDaemon.taskCatalog
    : null;
  const catalogParity = rustDaemon.catalogParity && typeof rustDaemon.catalogParity === 'object'
    ? rustDaemon.catalogParity
    : null;
  const taskCount = Array.isArray(taskCatalog?.tasks) ? taskCatalog.tasks.length : 0;
  const version = cleanString(taskCatalog?.version);
  const missingTaskTypes = Array.isArray(catalogParity?.missingTaskTypes)
    ? catalogParity.missingTaskTypes.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const extraTaskTypes = Array.isArray(catalogParity?.extraTaskTypes)
    ? catalogParity.extraTaskTypes.map((item) => cleanString(item)).filter(Boolean)
    : [];

  if (refreshedAt) rows.push({ label: 'Rust Checked', value: refreshedAt });
  if (transport) rows.push({ label: 'Rust Transport', value: transport });
  if (endpoint) rows.push({ label: 'Rust Endpoint', value: endpoint });
  if (socketPath) rows.push({ label: 'Rust Socket', value: socketPath });
  if (version) rows.push({ label: 'Rust Task Catalog', value: `${version} (${taskCount} tasks)` });
  if (cleanString(catalogParity?.status)) {
    rows.push({ label: 'Rust Catalog Parity', value: cleanString(catalogParity.status) });
  }
  if (missingTaskTypes.length > 0) {
    rows.push({ label: 'Rust Missing Tasks', value: missingTaskTypes.join(', ') });
  }
  if (extraTaskTypes.length > 0) {
    rows.push({ label: 'Rust Extra Tasks', value: extraTaskTypes.join(', ') });
  }
  return rows;
}

function buildBootstrapRuntimeCommands(bootstrap = null) {
  const runtimeOptions = bootstrap && typeof bootstrap === 'object' ? bootstrap.runtimeOptions : null;
  const rustPrototype = runtimeOptions && typeof runtimeOptions === 'object'
    ? runtimeOptions.rustDaemonPrototype
    : null;
  const commands = rustPrototype && typeof rustPrototype === 'object' ? rustPrototype.commands : null;
  const debugCommands = bootstrap && typeof bootstrap === 'object' && bootstrap.debugCommands && typeof bootstrap.debugCommands === 'object'
    ? bootstrap.debugCommands
    : null;
  const items = [];
  const launcherCommand = cleanString(commands?.launcher);
  const httpCommand = cleanString(commands?.http);
  const unixCommand = cleanString(commands?.unix);
  const verifyCommand = cleanString(commands?.verify);
  if (launcherCommand) {
    items.push({
      key: 'rust-launcher',
      label: 'Rust daemon (Launcher)',
      command: launcherCommand,
    });
  }
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
  if (verifyCommand) {
    items.push({
      key: 'rust-verify',
      label: 'Rust daemon (Verify)',
      command: verifyCommand,
    });
  }
  const debugHealth = cleanString(debugCommands?.health);
  const debugRuntime = cleanString(debugCommands?.runtime);
  const debugTaskCatalog = cleanString(debugCommands?.taskCatalog);
  if (debugHealth) {
    items.push({
      key: 'rust-debug-health',
      label: 'Rust debug (Health)',
      command: debugHealth,
    });
  }
  if (debugRuntime) {
    items.push({
      key: 'rust-debug-runtime',
      label: 'Rust debug (Runtime)',
      command: debugRuntime,
    });
  }
  if (debugTaskCatalog) {
    items.push({
      key: 'rust-debug-task-catalog',
      label: 'Rust debug (Task Catalog)',
      command: debugTaskCatalog,
    });
  }
  return items;
}

function buildBootstrapRuntimeCommandGroups(items = []) {
  const groups = [
    { key: 'operate', title: 'Operate', match: (item) => item?.key === 'rust-launcher' },
    { key: 'serve', title: 'Serve', match: (item) => item?.key === 'rust-http' || item?.key === 'rust-unix' },
    { key: 'verify', title: 'Verify', match: (item) => item?.key === 'rust-verify' },
    { key: 'debug', title: 'Debug', match: (item) => String(item?.key || '').startsWith('rust-debug-') },
  ];
  return groups
    .map((group) => ({
      key: group.key,
      title: group.title,
      items: (Array.isArray(items) ? items : []).filter((item) => group.match(item)),
    }))
    .filter((group) => group.items.length > 0);
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
  buildBootstrapRuntimeCommandGroups,
  buildBootstrapRuntimeCommands,
  buildBootstrapRuntimeEnvFiles,
  buildClientDeviceOption,
  buildRustDaemonStatusRows,
  buildRustDaemonStatusNote,
  filterOnlineClientDevices,
  getRustDaemonPayload,
};
