'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value = '') {
  return cleanString(value).toUpperCase();
}

function buildRunReviewSummary(runs = []) {
  const items = Array.isArray(runs) ? runs : [];
  let activeCount = 0;
  let attentionCount = 0;
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let contractFailureCount = 0;

  items.forEach((run) => {
    const status = normalizeStatus(run?.status);
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
    status,
  };
}

module.exports = {
  buildRunReviewSummary,
};
