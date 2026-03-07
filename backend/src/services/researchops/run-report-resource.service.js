'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function loadRunReportResources({
  userId,
  runId,
  store,
} = {}) {
  const normalizedRunId = cleanString(runId);
  const normalizedStore = store && typeof store === 'object' ? store : null;
  if (!normalizedStore) {
    throw new Error('store is required');
  }
  if (!normalizedRunId) {
    throw new Error('runId is required');
  }
  const [run, steps, artifacts, checkpoints] = await Promise.all([
    normalizedStore.getRun(userId, normalizedRunId),
    normalizedStore.listRunSteps(userId, normalizedRunId),
    normalizedStore.listRunArtifacts(userId, normalizedRunId, { limit: 1000 }),
    normalizedStore.listRunCheckpoints(userId, normalizedRunId, { limit: 500 }),
  ]);
  return {
    run,
    steps,
    artifacts,
    checkpoints,
  };
}

async function maybeDownloadJson(artifact = null, downloadBuffer = async () => null) {
  if (!artifact?.objectKey) return null;
  const buffer = await downloadBuffer(artifact.objectKey).catch(() => null);
  if (!buffer) return null;
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (_) {
    return null;
  }
}

async function loadRunReportInlineData({
  artifacts = [],
  includeInline = false,
  downloadBuffer = async () => null,
} = {}) {
  let summaryText = null;
  let manifest = null;
  if (!includeInline) {
    return { summaryText, manifest };
  }
  const normalizedArtifacts = Array.isArray(artifacts) ? artifacts : [];
  const summaryArtifact = normalizedArtifacts.find((item) => item.kind === 'run_summary_md') || null;
  const manifestArtifact = normalizedArtifacts.find((item) => item.kind === 'result_manifest') || null;

  if (summaryArtifact?.objectKey) {
    const buffer = await downloadBuffer(summaryArtifact.objectKey).catch(() => null);
    summaryText = buffer ? buffer.toString('utf8') : null;
  } else {
    summaryText = summaryArtifact?.metadata?.inlinePreview || null;
  }

  manifest = await maybeDownloadJson(manifestArtifact, downloadBuffer);
  if (!manifest) {
    const preview = manifestArtifact?.metadata?.inlinePreview;
    if (preview) {
      try {
        manifest = JSON.parse(preview);
      } catch (_) {
        manifest = null;
      }
    }
  }

  return { summaryText, manifest };
}

module.exports = {
  loadRunReportResources,
  loadRunReportInlineData,
};
