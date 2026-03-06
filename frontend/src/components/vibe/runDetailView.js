import { getRunSourceLabel } from './runPresentation.js';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  return {
    sourceLabel: getRunSourceLabel(run),
    treeNodeTitle: cleanString(metadata.treeNodeTitle),
    todoTitle: cleanString(metadata.todoTitle),
    parentRunId: cleanString(metadata.parentRunId),
    serverId: cleanString(run?.serverId),
    workspacePath: cleanString(runReport?.runWorkspacePath)
      || cleanString(runReport?.workspace?.path)
      || cleanString(metadata.runWorkspacePath),
  };
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
  return {
    status: cleanString(run?.status).toUpperCase() || 'UNKNOWN',
    summary: cleanString(runReport?.summary),
    finalOutputArtifact: findFinalOutputArtifact(artifacts, highlights),
    deliverables,
    errorText: cleanString(run?.lastMessage),
  };
}

export {
  buildRunDetailContext,
  buildRunDetailOutput,
  buildRunDetailPrompt,
};
