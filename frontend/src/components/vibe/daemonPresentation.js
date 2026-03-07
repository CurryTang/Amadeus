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
  const snapshotReady = device?.capabilities?.supportsWorkspaceSnapshotCapture === true;
  const parts = [status];
  if (location) parts.push(location);
  if (bridgeReady) parts.push('bridge ready');
  if (snapshotReady) parts.push('snapshot ready');
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

function getRuntimeOverviewClientDevices(input = null) {
  if (!input || typeof input !== 'object') return [];
  const daemons = input.daemons && typeof input.daemons === 'object' ? input.daemons : null;
  return Array.isArray(daemons?.items) ? daemons.items : [];
}

function getRuntimeOverviewRustStatus(input = null) {
  if (!input || typeof input !== 'object') return null;
  return input.rustDaemon && typeof input.rustDaemon === 'object' ? input.rustDaemon : null;
}

function getRuntimeOverviewSummary(input = null) {
  if (!input || typeof input !== 'object') return null;
  return input.summary && typeof input.summary === 'object' ? input.summary : null;
}

function buildRuntimeOverviewSummaryRows(summary = null) {
  const source = summary && typeof summary === 'object' ? summary : {};
  const rows = [];
  const onlineClients = Number.isFinite(Number(source.onlineClients)) ? Number(source.onlineClients) : null;
  const bridgeReadyClients = Number.isFinite(Number(source.bridgeReadyClients)) ? Number(source.bridgeReadyClients) : null;
  const snapshotReadyClients = Number.isFinite(Number(source.snapshotReadyClients)) ? Number(source.snapshotReadyClients) : null;
  const runningCount = Number.isFinite(Number(source.runningCount)) ? Number(source.runningCount) : null;
  if (onlineClients !== null) rows.push({ label: 'Online Clients', value: String(onlineClients) });
  if (bridgeReadyClients !== null) rows.push({ label: 'Bridge-Ready Clients', value: String(bridgeReadyClients) });
  if (snapshotReadyClients !== null) rows.push({ label: 'Snapshot-Ready Clients', value: String(snapshotReadyClients) });
  if (source.rustBridgeReady === true || source.rustBridgeReady === false) {
    rows.push({ label: 'Rust Bridge Ready', value: source.rustBridgeReady ? 'yes' : 'no' });
  }
  if (source.rustSnapshotReady === true || source.rustSnapshotReady === false) {
    rows.push({ label: 'Rust Snapshot Ready', value: source.rustSnapshotReady ? 'yes' : 'no' });
  }
  if (source.rustManagedRunning === true || source.rustManagedRunning === false) {
    rows.push({ label: 'Rust Managed', value: source.rustManagedRunning ? 'yes' : 'no' });
  }
  if (runningCount !== null) rows.push({ label: 'Running Jobs', value: String(runningCount) });
  return rows;
}

function buildRuntimeOverviewPanelRows({
  runtimeOverviewSummary = null,
  rustDaemonStatus = null,
} = {}) {
  return [
    ...buildRuntimeOverviewSummaryRows(runtimeOverviewSummary),
    ...buildRustDaemonStatusRows(rustDaemonStatus),
  ];
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
    if (runtime.supports_workspace_snapshot_capture === true) parts.push('snapshot ready');
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
  const runtime = rustDaemon.runtime && typeof rustDaemon.runtime === 'object'
    ? rustDaemon.runtime
    : null;
  const supervisor = rustDaemon.supervisor && typeof rustDaemon.supervisor === 'object'
    ? rustDaemon.supervisor
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
  if (supervisor?.running === true || supervisor?.running === false) {
    rows.push({ label: 'Rust Managed', value: supervisor.running ? 'yes' : 'no' });
  }
  if (Number.isFinite(Number(supervisor?.pid)) && Number(supervisor.pid) > 0) {
    rows.push({ label: 'Rust PID', value: String(supervisor.pid) });
  }
  if (cleanString(supervisor?.pidFile)) {
    rows.push({ label: 'Rust PID File', value: cleanString(supervisor.pidFile) });
  }
  if (cleanString(supervisor?.logFile)) {
    rows.push({ label: 'Rust Log', value: cleanString(supervisor.logFile) });
  }
  if (runtime?.supports_workspace_snapshot_capture === true) {
    rows.push({ label: 'Rust Snapshot Capture', value: 'ready' });
  }
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
  const backgroundCommand = cleanString(commands?.background);
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
  if (backgroundCommand) {
    items.push({
      key: 'rust-background',
      label: 'Rust daemon (Managed background)',
      command: backgroundCommand,
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
  const debugSnapshotCapture = cleanString(debugCommands?.snapshotCapture);
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
  if (debugSnapshotCapture) {
    items.push({
      key: 'rust-debug-snapshot-capture',
      label: 'Rust debug (Snapshot Capture)',
      command: debugSnapshotCapture,
    });
  }
  return items;
}

function buildBootstrapRuntimeCommandGroups(items = []) {
  const groups = [
    { key: 'operate', title: 'Operate', match: (item) => item?.key === 'rust-launcher' || item?.key === 'rust-background' },
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
  buildRuntimeOverviewPanelRows,
  buildRuntimeOverviewSummaryRows,
  buildRustDaemonStatusRows,
  buildRustDaemonStatusNote,
  filterOnlineClientDevices,
  getRuntimeOverviewSummary,
  getRustDaemonPayload,
  getRuntimeOverviewClientDevices,
  getRuntimeOverviewRustStatus,
};
