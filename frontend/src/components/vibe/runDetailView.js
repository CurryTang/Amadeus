import { getRunSourceLabel } from './runPresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  buildRunDetailContext,
  buildRunExecutionSummary,
  buildRunSnapshotSummary,
  buildRunDetailOutput,
  buildRunDetailPrompt,
};
