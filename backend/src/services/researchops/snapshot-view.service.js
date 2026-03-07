'use strict';

const { buildRunExecutionView } = require('./execution-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeResources(resources = {}) {
  const source = asObject(resources);
  return {
    cpu: cleanNumber(source.cpu),
    gpu: cleanNumber(source.gpu),
    ramGb: cleanNumber(source.ramGb),
    timeoutMin: cleanNumber(source.timeoutMin),
  };
}

function buildWorkspaceSnapshotView(run = {}, artifacts = [], runWorkspacePath = '') {
  const metadata = asObject(run?.metadata);
  const metadataWorkspaceSnapshot = asObject(metadata.workspaceSnapshot);
  const metadataLocalSnapshot = asObject(metadata.localSnapshot);
  const runSpecArtifact = (Array.isArray(artifacts) ? artifacts : []).find(
    (item) => cleanString(item?.kind) === 'run_spec_snapshot'
  ) || null;
  const localSnapshotKind = cleanString(metadataLocalSnapshot.kind);
  const localSnapshotNote = cleanString(metadataLocalSnapshot.note);
  return {
    path: cleanString(metadataWorkspaceSnapshot.path || runWorkspacePath) || null,
    sourceServerId: cleanString(metadataWorkspaceSnapshot.sourceServerId || metadata.cwdSourceServerId || run?.serverId) || null,
    runSpecArtifactId: cleanString(metadataWorkspaceSnapshot.runSpecArtifactId || runSpecArtifact?.id) || null,
    localSnapshot: localSnapshotKind || localSnapshotNote
      ? {
        ...(localSnapshotKind ? { kind: localSnapshotKind } : {}),
        ...(localSnapshotNote ? { note: localSnapshotNote } : {}),
      }
      : null,
  };
}

function buildEnvSnapshotView(run = {}) {
  const metadata = asObject(run?.metadata);
  const jobSpec = asObject(metadata.jobSpec);
  const execution = buildRunExecutionView(run);
  return {
    backend: cleanString(jobSpec.backend || execution.backend) || null,
    runtimeClass: cleanString(jobSpec.runtimeClass || execution.runtimeClass) || null,
    resources: normalizeResources(jobSpec.resources || execution.resources),
  };
}

module.exports = {
  buildEnvSnapshotView,
  buildWorkspaceSnapshotView,
};
