import { getRunSourceLabel } from './runPresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatReadiness(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'needs_attention') return 'Needs attention';
  if (normalized === 'pending_outputs') return 'Pending outputs';
  if (normalized === 'ready') return 'Ready';
  return '';
}

function formatContractStatus(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'validated') return 'Validated';
  if (normalized === 'failing') return 'Validation failed';
  return '';
}

function findArtifactById(artifacts = [], artifactId = '') {
  const targetId = cleanString(artifactId);
  if (!targetId) return null;
  return artifacts.find((item) => cleanString(item?.id) === targetId) || null;
}

function findFinalOutputArtifact(artifacts = [], highlights = {}) {
  const highlighted = findArtifactById(artifacts, highlights?.finalOutputArtifactId);
  if (highlighted) return highlighted;
  const preferredKinds = [
    'agent_final_json',
    'implementation_summary_json',
    'experiment_final_json',
    'result_manifest',
    'agent-output',
  ];
  return artifacts.find((item) => preferredKinds.includes(cleanString(item?.kind))) || null;
}

function buildRunDetailContext(run = {}, runReport = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const attempt = runReport?.attempt && typeof runReport.attempt === 'object' ? runReport.attempt : {};
  return {
    sourceLabel: getRunSourceLabel(run),
    treeNodeTitle: cleanString(metadata.treeNodeTitle) || cleanString(attempt.treeNodeTitle),
    todoTitle: cleanString(metadata.todoTitle),
    parentRunId: cleanString(metadata.parentRunId),
    serverId: cleanString(run?.serverId),
    workspacePath: cleanString(runReport?.runWorkspacePath)
      || cleanString(runReport?.workspace?.path)
      || cleanString(metadata.runWorkspacePath),
  };
}

function buildRunExecutionSummary(run = {}) {
  const execution = run?.execution && typeof run.execution === 'object' ? run.execution : {};
  const resources = execution?.resources && typeof execution.resources === 'object' ? execution.resources : {};
  const resourceBits = [
    ['cpu', cleanNumber(resources.cpu)],
    ['gpu', cleanNumber(resources.gpu)],
    ['ram', cleanNumber(resources.ramGb)],
    ['timeout', cleanNumber(resources.timeoutMin)],
  ].filter(([, value]) => value !== null);

  return {
    serverId: cleanString(execution.serverId) || cleanString(run?.serverId),
    location: cleanString(execution.location),
    mode: cleanString(execution.mode) || cleanString(run?.mode),
    backend: cleanString(execution.backend),
    runtimeClass: cleanString(execution.runtimeClass),
    resourcesLabel: resourceBits.map(([label, value]) => {
      if (label === 'ram') return `ram ${value}GB`;
      if (label === 'timeout') return `timeout ${value}m`;
      return `${label} ${value}`;
    }).join(' · '),
  };
}

function buildRunSnapshotSummary(run = {}, runReport = {}) {
  const workspaceSnapshot = runReport?.workspaceSnapshot && typeof runReport.workspaceSnapshot === 'object'
    ? runReport.workspaceSnapshot
    : {};
  const envSnapshot = runReport?.envSnapshot && typeof runReport.envSnapshot === 'object'
    ? runReport.envSnapshot
    : {};
  const envResources = envSnapshot?.resources && typeof envSnapshot.resources === 'object'
    ? envSnapshot.resources
    : {};
  const envResourceBits = [
    ['cpu', cleanNumber(envResources.cpu)],
    ['gpu', cleanNumber(envResources.gpu)],
    ['ram', cleanNumber(envResources.ramGb)],
    ['timeout', cleanNumber(envResources.timeoutMin)],
  ].filter(([, value]) => value !== null);

  const rows = [];
  if (cleanString(workspaceSnapshot.path)) {
    rows.push({ label: 'Workspace Path', value: cleanString(workspaceSnapshot.path) });
  }
  if (cleanString(workspaceSnapshot.sourceServerId)) {
    rows.push({ label: 'Workspace Source', value: cleanString(workspaceSnapshot.sourceServerId) });
  }
  if (cleanString(workspaceSnapshot.runSpecArtifactId)) {
    rows.push({ label: 'Run Spec', value: cleanString(workspaceSnapshot.runSpecArtifactId) });
  }
  const localSnapshot = workspaceSnapshot?.localSnapshot && typeof workspaceSnapshot.localSnapshot === 'object'
    ? workspaceSnapshot.localSnapshot
    : {};
  if (cleanString(localSnapshot.kind)) {
    rows.push({ label: 'Local Snapshot', value: cleanString(localSnapshot.kind) });
  }
  if (cleanString(localSnapshot.note)) {
    rows.push({ label: 'Local Note', value: cleanString(localSnapshot.note) });
  }
  if (cleanString(envSnapshot.backend)) {
    rows.push({ label: 'Env Backend', value: cleanString(envSnapshot.backend) });
  }
  if (cleanString(envSnapshot.runtimeClass)) {
    rows.push({ label: 'Runtime Class', value: cleanString(envSnapshot.runtimeClass) });
  }
  if (envResourceBits.length > 0) {
    rows.push({
      label: 'Env Resources',
      value: envResourceBits.map(([label, value]) => {
        if (label === 'ram') return `ram ${value}GB`;
        if (label === 'timeout') return `timeout ${value}m`;
        return `${label} ${value}`;
      }).join(' · '),
    });
  }
  return rows;
}

function buildRunFollowUpSummary(run = {}, runReport = {}) {
  const followUp = run?.followUp && typeof run.followUp === 'object'
    ? run.followUp
    : (runReport?.followUp && typeof runReport.followUp === 'object' ? runReport.followUp : {});
  const relatedRunIds = Array.isArray(followUp.relatedRunIds)
    ? followUp.relatedRunIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const rows = [];
  const parentRunId = cleanString(followUp.parentRunId || run?.metadata?.parentRunId);
  if (parentRunId) {
    rows.push({ label: 'Parent Run', value: parentRunId });
  }
  if (followUp.isContinuation) {
    rows.push({ label: 'Follow-up', value: 'Continuation' });
  }
  if (cleanString(followUp.continuationPhase)) {
    rows.push({ label: 'Phase', value: cleanString(followUp.continuationPhase) });
  }
  if (cleanString(followUp.branchLabel)) {
    rows.push({ label: 'Branch', value: cleanString(followUp.branchLabel) });
  }
  if (relatedRunIds.length > 0) {
    rows.push({ label: 'Related Runs', value: relatedRunIds.join(', ') });
  }
  return rows;
}

function buildRunBridgeSummary(run = {}, runReport = {}) {
  const bridgeRuntime = runReport?.bridgeRuntime && typeof runReport.bridgeRuntime === 'object'
    ? runReport.bridgeRuntime
    : {};
  const taskActions = runReport?.taskActions && typeof runReport.taskActions === 'object'
    ? runReport.taskActions
    : {};
  const rows = [];
  const runtimeTarget = cleanString(bridgeRuntime.executionTarget);
  const serverId = cleanString(bridgeRuntime.serverId);
  const missingBridgeTaskTypes = Array.isArray(bridgeRuntime.missingBridgeTaskTypes)
    ? bridgeRuntime.missingBridgeTaskTypes.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const availableTransports = Array.isArray(bridgeRuntime.availableTransports)
    ? bridgeRuntime.availableTransports.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const preferredTransport = cleanString(bridgeRuntime.preferredTransport);
  if (!runtimeTarget && !serverId && missingBridgeTaskTypes.length === 0 && !taskActions.fetchRunReport && !taskActions.submitRunNote) {
    return rows;
  }
  if (runtimeTarget) {
    rows.push({ label: 'Bridge Runtime', value: runtimeTarget });
  }
  if (serverId) {
    rows.push({ label: 'Bridge Server', value: serverId });
  }
  if (preferredTransport) {
    rows.push({ label: 'Preferred Transport', value: preferredTransport });
  }
  if (availableTransports.length > 0) {
    rows.push({ label: 'Available Transports', value: availableTransports.join(', ') });
  }
  rows.push({
    label: 'Bridge Transport',
    value: bridgeRuntime.supportsLocalBridgeWorkflow === true ? 'daemon-task ready' : 'daemon-task available',
  });
  if (missingBridgeTaskTypes.length > 0) {
    rows.push({ label: 'Missing Bridge Tasks', value: missingBridgeTaskTypes.join(', ') });
  }
  const reportTaskType = cleanString(taskActions?.fetchRunReport?.taskType);
  if (reportTaskType) {
    rows.push({ label: 'Bridge Report Task', value: reportTaskType });
  }
  const noteTaskType = cleanString(taskActions?.submitRunNote?.taskType);
  if (noteTaskType) {
    rows.push({ label: 'Bridge Note Task', value: noteTaskType });
  }
  const snapshotTaskType = cleanString(taskActions?.captureWorkspaceSnapshot?.taskType);
  if (snapshotTaskType) {
    rows.push({ label: 'Snapshot Capture', value: snapshotTaskType });
  } else if (bridgeRuntime?.capabilities?.canCaptureWorkspaceSnapshot === true) {
    rows.push({ label: 'Snapshot Capture', value: 'Available' });
  }
  return rows;
}

function buildRunObservabilitySummary(run = {}, runReport = {}) {
  const observability = runReport?.observability && typeof runReport.observability === 'object'
    ? runReport.observability
    : null;
  if (observability) {
    const counts = observability?.counts && typeof observability.counts === 'object'
      ? observability.counts
      : {};
    const statuses = observability?.statuses && typeof observability.statuses === 'object'
      ? observability.statuses
      : {};
    const sinkProviders = Array.isArray(observability.sinkProviders)
      ? observability.sinkProviders.map((item) => cleanString(item)).filter(Boolean)
      : [];
    const warnings = Array.isArray(observability.warnings)
      ? observability.warnings.map((item) => cleanString(item)).filter(Boolean)
      : [];
    const rows = [];
    const readinessLabel = formatReadiness(statuses.readiness);
    const contractLabel = formatContractStatus(statuses.contract);
    if (readinessLabel) {
      rows.push({ label: 'Readiness', value: readinessLabel });
    }
    if (cleanNumber(counts.steps) || counts.steps === 0) {
      if (cleanNumber(counts.steps) || Number(counts.steps) === 0) {
        rows.push({ label: 'Steps', value: `${Number(counts.steps) || 0} recorded` });
      }
    }
    if (cleanNumber(counts.artifacts) || Number(counts.artifacts) === 0) {
      rows.push({ label: 'Artifacts', value: `${Number(counts.artifacts) || 0} captured` });
    }
    if (cleanNumber(counts.checkpoints) || Number(counts.checkpoints) > 0) {
      const pending = Math.max(Number(counts.pendingCheckpoints) || 0, 0);
      const resolved = Math.max(Number(counts.resolvedCheckpoints) || 0, 0);
      if ((Number(counts.checkpoints) || 0) > 0) {
        rows.push({
          label: 'Checkpoints',
          value: pending > 0 ? `${pending} pending · ${resolved} resolved` : `${resolved} resolved`,
        });
      }
    }
    if (sinkProviders.length > 0) {
      rows.push({ label: 'Sinks', value: sinkProviders.join(', ') });
    }
    if (contractLabel) {
      rows.push({ label: 'Contract', value: contractLabel });
    }
    if ((Number(counts.deliverables) || 0) > 0) {
      rows.push({ label: 'Deliverables', value: `${Number(counts.deliverables) || 0} captured` });
    }
    if (warnings.length > 0) {
      const preview = warnings.slice(0, 2).join(' · ');
      const extraCount = Math.max(warnings.length - 2, 0);
      rows.push({
        label: 'Warnings',
        value: extraCount > 0 ? `${preview} +${extraCount} more` : preview,
      });
    }
    return rows;
  }

  const steps = Array.isArray(runReport?.steps) ? runReport.steps : [];
  const artifacts = Array.isArray(runReport?.artifacts) ? runReport.artifacts : [];
  const checkpoints = Array.isArray(runReport?.checkpoints) ? runReport.checkpoints : [];
  const highlights = runReport?.highlights && typeof runReport.highlights === 'object'
    ? runReport.highlights
    : {};
  const pendingCheckpointCount = checkpoints
    .filter((item) => cleanString(item?.status).toUpperCase() === 'PENDING')
    .length;
  const resolvedCheckpointCount = Math.max(checkpoints.length - pendingCheckpointCount, 0);
  const deliverableArtifactIds = Array.isArray(highlights.deliverableArtifactIds)
    ? highlights.deliverableArtifactIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const finalOutputArtifact = findFinalOutputArtifact(artifacts, highlights);

  const rows = [];
  if (steps.length > 0) {
    rows.push({ label: 'Steps', value: `${steps.length} recorded` });
  }
  if (artifacts.length > 0) {
    rows.push({ label: 'Artifacts', value: `${artifacts.length} captured` });
  }
  if (checkpoints.length > 0) {
    rows.push({
      label: 'Checkpoints',
      value: pendingCheckpointCount > 0
        ? `${pendingCheckpointCount} pending · ${resolvedCheckpointCount} resolved`
        : `${resolvedCheckpointCount} resolved`,
    });
  }
  if (cleanString(runReport?.summary)) {
    rows.push({ label: 'Summary', value: 'Present' });
  }
  if (finalOutputArtifact) {
    rows.push({ label: 'Final Output', value: 'Present' });
  }
  if (deliverableArtifactIds.length > 0) {
    rows.push({ label: 'Deliverables', value: `${deliverableArtifactIds.length} captured` });
  }
  return rows;
}

function deriveRunCompareTargetId(run = {}, runReport = {}) {
  const runId = cleanString(run?.id);
  const runFollowUp = run?.followUp && typeof run.followUp === 'object' ? run.followUp : {};
  const reportFollowUp = runReport?.followUp && typeof runReport.followUp === 'object' ? runReport.followUp : {};
  const relatedRunIds = [
    ...(Array.isArray(runFollowUp.relatedRunIds) ? runFollowUp.relatedRunIds : []),
    ...(Array.isArray(reportFollowUp.relatedRunIds) ? reportFollowUp.relatedRunIds : []),
  ].map((item) => cleanString(item)).filter(Boolean);
  const relatedCandidate = relatedRunIds.find((item) => item && item !== runId);
  if (relatedCandidate) return relatedCandidate;
  return cleanString(
    runFollowUp.parentRunId
    || reportFollowUp.parentRunId
    || run?.metadata?.parentRunId
  );
}

function buildRunCompareSummary(comparePayload = {}) {
  const other = comparePayload?.other && typeof comparePayload.other === 'object' ? comparePayload.other : {};
  const relation = comparePayload?.relation && typeof comparePayload.relation === 'object' ? comparePayload.relation : {};
  const observability = other?.report?.observability && typeof other.report.observability === 'object'
    ? other.report.observability
    : {};
  const relatedRunIds = Array.isArray(relation.relatedRunIds)
    ? relation.relatedRunIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const sharedParentRunIds = Array.isArray(relation.sharedParentRunIds)
    ? relation.sharedParentRunIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const deliverableArtifactIds = Array.isArray(other?.report?.highlights?.deliverableArtifactIds)
    ? other.report.highlights.deliverableArtifactIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const otherRunId = cleanString(other?.run?.id);
  if (!otherRunId) return null;
  return {
    otherRunId,
    otherStatus: cleanString(other?.run?.status).toUpperCase() || 'UNKNOWN',
    otherNodeTitle: cleanString(other?.attempt?.treeNodeTitle),
    otherSummary: cleanString(other?.report?.summary),
    otherReadiness: formatReadiness(observability?.statuses?.readiness),
    otherWarnings: Math.max(Number(observability?.counts?.warnings) || 0, 0) > 0
      ? `${Math.max(Number(observability?.counts?.warnings) || 0, 0)} warnings`
      : '',
    sharedParentRunsLabel: sharedParentRunIds.join(', '),
    relatedRunsLabel: relatedRunIds.join(', '),
    deliverableCount: deliverableArtifactIds.length,
    sameNode: Boolean(relation.sameNode),
  };
}

function getRunOptionLabel(run = {}) {
  return cleanString(run?.metadata?.prompt)
    || cleanString(run?.metadata?.experimentCommand)
    || cleanString(run?.metadata?.command)
    || cleanString(run?.metadata?.treeNodeTitle)
    || cleanString(run?.attempt?.treeNodeTitle)
    || cleanString(run?.id);
}

function buildRunCompareOptions(run = {}, runReport = {}, visibleRuns = []) {
  const currentRunId = cleanString(run?.id);
  const optionById = new Map();
  const visibleRunMap = new Map(
    (Array.isArray(visibleRuns) ? visibleRuns : [])
      .map((item) => [cleanString(item?.id), item])
      .filter(([id]) => id)
  );
  const followUpSources = [
    run?.followUp && typeof run.followUp === 'object' ? run.followUp : {},
    runReport?.followUp && typeof runReport.followUp === 'object' ? runReport.followUp : {},
  ];
  followUpSources.forEach((followUp) => {
    const candidates = [
      ...(Array.isArray(followUp.relatedRunIds) ? followUp.relatedRunIds : []),
      followUp.parentRunId,
      followUp.continuationOfRunId,
    ];
    candidates.forEach((candidate) => {
      const value = cleanString(candidate);
      if (!value || value === currentRunId || optionById.has(value)) return;
      const knownRun = visibleRunMap.get(value) || { id: value };
      optionById.set(value, {
        value,
        label: getRunOptionLabel(knownRun),
      });
    });
  });
  return [...optionById.values()];
}

function buildRunContractSummary(run = {}, runReport = {}) {
  const contract = runReport?.contract && typeof runReport.contract === 'object'
    ? runReport.contract
    : {};
  const rows = [];
  const requiredArtifacts = Array.isArray(contract.requiredArtifacts)
    ? contract.requiredArtifacts.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const tables = Array.isArray(contract.tables)
    ? contract.tables.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const figures = Array.isArray(contract.figures)
    ? contract.figures.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const metricKeys = Array.isArray(contract.metricKeys)
    ? contract.metricKeys.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const missingTables = Array.isArray(contract.missingTables)
    ? contract.missingTables.map((item) => cleanString(item)).filter(Boolean)
    : [];
  const missingFigures = Array.isArray(contract.missingFigures)
    ? contract.missingFigures.map((item) => cleanString(item)).filter(Boolean)
    : [];

  if (requiredArtifacts.length > 0) {
    rows.push({ label: 'Required Artifacts', value: requiredArtifacts.join(', ') });
  }
  if (tables.length > 0) {
    rows.push({ label: 'Tables', value: tables.join(', ') });
  }
  if (figures.length > 0) {
    rows.push({ label: 'Figures', value: figures.join(', ') });
  }
  if (metricKeys.length > 0) {
    rows.push({ label: 'Metric Keys', value: metricKeys.join(', ') });
  }
  if (contract.summaryRequired) {
    rows.push({ label: 'Summary', value: 'Required' });
  }
  if (contract.ok === true) {
    rows.push({ label: 'Contract Check', value: 'Validated' });
  } else if (contract.ok === false) {
    rows.push({ label: 'Contract Check', value: 'Validation failed' });
  }
  if (missingTables.length > 0) {
    rows.push({ label: 'Missing Tables', value: missingTables.join(', ') });
  }
  if (missingFigures.length > 0) {
    rows.push({ label: 'Missing Figures', value: missingFigures.join(', ') });
  }
  return rows;
}

function buildRunDetailPrompt(run = {}) {
  const metadata = run?.metadata && typeof run.metadata === 'object' ? run.metadata : {};
  const promptText = cleanString(metadata.prompt);
  if (promptText) {
    return {
      label: 'User Prompt',
      text: promptText,
    };
  }
  return {
    label: 'Command',
    text: cleanString(metadata.experimentCommand) || cleanString(metadata.command),
  };
}

function buildRunDetailOutput(run = {}, runReport = {}) {
  const artifacts = Array.isArray(runReport?.artifacts) ? runReport.artifacts : [];
  const manifest = runReport?.manifest && typeof runReport.manifest === 'object'
    ? runReport.manifest
    : {};
  const highlights = runReport?.highlights && typeof runReport.highlights === 'object'
    ? runReport.highlights
    : {};
  const deliverables = [
    ...(Array.isArray(manifest.figures) ? manifest.figures : []),
    ...(Array.isArray(manifest.tables) ? manifest.tables : []),
  ];
  const deliverableArtifacts = Array.isArray(highlights?.deliverableArtifactIds)
    ? highlights.deliverableArtifactIds
      .map((artifactId) => findArtifactById(artifacts, artifactId))
      .filter(Boolean)
    : [];
  return {
    status: cleanString(run?.status).toUpperCase() || 'UNKNOWN',
    summary: cleanString(runReport?.summary),
    finalOutputArtifact: findFinalOutputArtifact(artifacts, highlights),
    deliverables,
    deliverableArtifacts,
    errorText: cleanString(run?.lastMessage),
  };
}

export {
  buildRunCompareOptions,
  buildRunCompareSummary,
  buildRunContractSummary,
  buildRunDetailContext,
  buildRunBridgeSummary,
  buildRunObservabilitySummary,
  buildRunExecutionSummary,
  buildRunFollowUpSummary,
  buildRunSnapshotSummary,
  buildRunDetailOutput,
  buildRunDetailPrompt,
  deriveRunCompareTargetId,
};
