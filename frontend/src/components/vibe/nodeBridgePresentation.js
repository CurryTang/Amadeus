function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildNodeBridgeSummary(payload = {}) {
  const bridgeRuntime = asObject(payload?.bridgeRuntime);
  const capabilities = asObject(payload?.capabilities);
  const taskActions = asObject(payload?.taskActions);
  const rows = [];

  const executionTarget = cleanString(bridgeRuntime.executionTarget);
  const serverId = cleanString(bridgeRuntime.serverId);
  const resolvedTransport = cleanString(payload?.resolvedTransport);
  const preferredTransport = cleanString(bridgeRuntime.preferredTransport);
  const availableTransports = Array.isArray(bridgeRuntime.availableTransports)
    ? bridgeRuntime.availableTransports.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const missingBridgeTaskTypes = Array.isArray(bridgeRuntime.missingBridgeTaskTypes)
    ? bridgeRuntime.missingBridgeTaskTypes.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const snapshotKinds = [];
  if (capabilities.hasWorkspaceSnapshot) snapshotKinds.push('workspace');
  if (capabilities.hasLocalSnapshot) snapshotKinds.push('local');
  if (capabilities.hasEnvSnapshot) snapshotKinds.push('env');

  if (!executionTarget
    && !serverId
    && !preferredTransport
    && availableTransports.length === 0
    && missingBridgeTaskTypes.length === 0
    && !capabilities.hasLastRun
    && !capabilities.hasBridgeReport
    && !capabilities.hasContextPack
    && snapshotKinds.length === 0
    && !taskActions.fetchNodeContext
    && !taskActions.submitNodeRun) {
    return rows;
  }

  if (executionTarget) rows.push({ label: 'Runtime', value: executionTarget });
  if (serverId) rows.push({ label: 'Server', value: serverId });
  if (resolvedTransport) rows.push({ label: 'Resolved Transport', value: resolvedTransport });
  if (preferredTransport) rows.push({ label: 'Preferred Transport', value: preferredTransport });
  if (availableTransports.length > 0) {
    rows.push({ label: 'Available Transports', value: availableTransports.join(', ') });
  }
  if (capabilities.canUseLocalBridgeWorkflow === true) {
    rows.push({ label: 'Bridge Workflow', value: 'Ready' });
  } else if (missingBridgeTaskTypes.length > 0) {
    rows.push({ label: 'Bridge Workflow', value: `Missing ${missingBridgeTaskTypes.length} tasks` });
  }
  if (capabilities.hasLastRun) rows.push({ label: 'Last Run', value: 'Available' });
  if (capabilities.hasBridgeReport) rows.push({ label: 'Bridge Report', value: 'Available' });
  if (capabilities.hasContextPack) rows.push({ label: 'Bridge Context', value: 'Context pack available' });
  if (snapshotKinds.length > 0) rows.push({ label: 'Snapshots', value: snapshotKinds.join(', ') });
  if (bridgeRuntime?.capabilities?.canCaptureWorkspaceSnapshot === true
    && !cleanString(taskActions?.captureWorkspaceSnapshot?.taskType)) {
    rows.push({ label: 'Snapshot Capture', value: 'Available' });
  }
  if (capabilities.hasContractFailures === true) rows.push({ label: 'Contract', value: 'Failures detected' });

  const fetchTaskType = cleanString(taskActions?.fetchNodeContext?.taskType);
  if (fetchTaskType) rows.push({ label: 'Fetch Task', value: fetchTaskType });
  const runTaskType = cleanString(taskActions?.submitNodeRun?.taskType);
  if (runTaskType) rows.push({ label: 'Run Task', value: runTaskType });
  const snapshotTaskType = cleanString(taskActions?.captureWorkspaceSnapshot?.taskType);
  if (snapshotTaskType) rows.push({ label: 'Snapshot Capture', value: snapshotTaskType });
  return rows;
}

export {
  buildNodeBridgeSummary,
};
