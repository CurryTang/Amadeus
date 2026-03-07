'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanSnapshotObject(input = {}) {
  const source = asObject(input);
  const path = cleanString(source.path);
  const sourceServerId = cleanString(source.sourceServerId);
  const runSpecArtifactId = cleanString(source.runSpecArtifactId);
  if (!path && !sourceServerId && !runSpecArtifactId) return null;
  return {
    path: path || null,
    sourceServerId: sourceServerId || null,
    runSpecArtifactId: runSpecArtifactId || null,
  };
}

function cleanLocalSnapshot(input = {}) {
  const source = asObject(input);
  const kind = cleanString(source.kind);
  const note = cleanString(source.note);
  if (!kind && !note) return null;
  return {
    ...(kind ? { kind } : {}),
    ...(note ? { note } : {}),
  };
}

function shouldUseGitManagedTreeRun({
  node = {},
  runSource = 'run-step',
} = {}) {
  const normalizedKind = cleanString(node?.kind).toLowerCase();
  if (normalizedKind === 'setup') return false;
  if (cleanString(runSource).toLowerCase() === 'jumpstart') return false;
  return true;
}

function buildTreeRunMetadata({
  project = {},
  node = {},
  runSource = 'run-step',
  commands = [],
  clarifyMessages = [],
  workspaceSnapshot = null,
  localSnapshot = null,
} = {}) {
  const joinedCommand = (Array.isArray(commands) ? commands : []).join(' && ') || 'echo "node has no commands"';
  const cleanedWorkspaceSnapshot = cleanSnapshotObject(workspaceSnapshot);
  const cleanedLocalSnapshot = cleanLocalSnapshot(localSnapshot);
  return {
    sourceType: 'tree',
    sourceLabel: 'Tree',
    nodeId: node.id,
    treeNodeId: node.id,
    treeNodeTitle: String(node?.title || node?.id || '').trim(),
    runSource,
    planNodeKind: node.kind || 'experiment',
    baseCommit: String(node?.git?.base || 'HEAD').trim(),
    gitManaged: shouldUseGitManagedTreeRun({ node, runSource }),
    commandCount: Array.isArray(commands) ? commands.length : 0,
    experimentCommand: joinedCommand,
    command: 'bash',
    args: ['-lc', joinedCommand],
    cwd: String(project?.projectPath || '').trim() || undefined,
    ...(Array.isArray(clarifyMessages) && clarifyMessages.length > 0 ? { clarifyContext: clarifyMessages } : {}),
    ...(cleanedWorkspaceSnapshot ? { workspaceSnapshot: cleanedWorkspaceSnapshot } : {}),
    ...(cleanedLocalSnapshot ? { localSnapshot: cleanedLocalSnapshot } : {}),
  };
}

module.exports = {
  buildTreeRunMetadata,
  shouldUseGitManagedTreeRun,
};
