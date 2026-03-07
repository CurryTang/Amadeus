'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value = '') {
  return cleanString(value).toUpperCase();
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildRunReviewSummary(runs = []) {
  const items = Array.isArray(runs) ? runs : [];
  let activeCount = 0;
  let attentionCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let contractFailureCount = 0;
  let remoteExecutionCount = 0;
  let snapshotBackedCount = 0;
  let instrumentedCount = 0;
  const instrumentedProviders = new Set();

  items.forEach((run) => {
    const status = normalizeStatus(run?.status);
    const execution = readObject(run?.execution);
    const metadata = readObject(run?.metadata);
    const workspaceSnapshot = readObject(run?.workspaceSnapshot);
    const observability = readObject(run?.observability);
    const localSnapshot = readObject(workspaceSnapshot.localSnapshot || metadata.localSnapshot);
    if (['RUNNING', 'QUEUED', 'PENDING'].includes(status)) {
      activeCount += 1;
    } else if (status === 'SUCCEEDED') {
      completedCount += 1;
    } else if (status === 'FAILED') {
      failedCount += 1;
      attentionCount += 1;
    } else if (status === 'CANCELLED') {
      cancelledCount += 1;
      attentionCount += 1;
    }
    if (run?.contract?.ok === false) {
      contractFailureCount += 1;
      if (!['FAILED', 'CANCELLED'].includes(status)) {
        attentionCount += 1;
      }
    }
    if (cleanString(execution.location) === 'remote' || cleanString(run?.serverId) && cleanString(run?.serverId) !== 'local-default') {
      remoteExecutionCount += 1;
    }
    if (cleanString(localSnapshot.kind) || cleanString(localSnapshot.note)) {
      snapshotBackedCount += 1;
    }
    if (Array.isArray(observability.sinkProviders) && observability.sinkProviders.some((item) => cleanString(item))) {
      instrumentedCount += 1;
      observability.sinkProviders.forEach((item) => {
        const value = cleanString(item);
        if (value) instrumentedProviders.add(value);
      });
    }
  });

  let status = 'idle';
  if (attentionCount > 0) {
    status = 'needs_attention';
  } else if (activeCount > 0) {
    status = 'active';
  } else if (completedCount > 0) {
    status = 'stable';
  }

  return {
    totalCount: items.length,
    activeCount,
    attentionCount,
    completedCount,
    failedCount,
    cancelledCount,
    contractFailureCount,
    remoteExecutionCount,
    snapshotBackedCount,
    instrumentedCount,
    instrumentedProviders: [...instrumentedProviders].sort((a, b) => a.localeCompare(b)),
    status,
  };
}

module.exports = {
  buildRunReviewSummary,
};
