'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStatus(value) {
  const normalized = cleanString(value).toLowerCase();
  return normalized || null;
}

function normalizeArtifacts(artifacts = []) {
  if (!Array.isArray(artifacts)) return [];
  return artifacts.reduce((acc, item) => {
    const source = asObject(item);
    const id = cleanString(source.id);
    const kind = cleanString(source.kind);
    const path = cleanString(source.path);
    const title = cleanString(source.title);
    if (!id && !kind && !path && !title) {
      return acc;
    }
    acc.push({
      ...(id ? { id } : {}),
      ...(kind ? { kind } : {}),
      ...(path ? { path } : {}),
      ...(title ? { title } : {}),
    });
    return acc;
  }, []);
}

function normalizeMetrics(metrics = {}) {
  const source = asObject(metrics);
  return Object.entries(source).reduce((acc, [key, value]) => {
    const numericValue = cleanNumber(value);
    if (numericValue !== null) {
      acc[key] = numericValue;
    }
    return acc;
  }, {});
}

function normalizeLogDigest(logDigest = {}) {
  const source = asObject(logDigest);
  const lineCount = cleanNumber(source.lineCount);
  const stdoutBytes = cleanNumber(source.stdoutBytes);
  const stderrBytes = cleanNumber(source.stderrBytes);
  const excerpt = cleanString(source.excerpt);
  return {
    ...(lineCount !== null ? { lineCount } : {}),
    ...(stdoutBytes !== null ? { stdoutBytes } : {}),
    ...(stderrBytes !== null ? { stderrBytes } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

function normalizeFailureSummary(failureSummary = {}) {
  const source = asObject(failureSummary);
  const code = cleanString(source.code);
  const message = cleanString(source.message);
  const hasRetryable = Object.prototype.hasOwnProperty.call(source, 'retryable');
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    ...(hasRetryable ? { retryable: Boolean(source.retryable) } : {}),
  };
}

function buildExecutionResultPayload({ result = null } = {}) {
  const source = asObject(result);
  return {
    executionId: cleanString(source.executionId) || null,
    status: normalizeStatus(source.status),
    exitCode: cleanNumber(source.exitCode),
    artifacts: normalizeArtifacts(source.artifacts),
    metrics: normalizeMetrics(source.metrics),
    logDigest: normalizeLogDigest(source.logDigest),
    failureSummary: normalizeFailureSummary(source.failureSummary),
  };
}

module.exports = {
  buildExecutionResultPayload,
};
