'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeResources(resources = {}) {
  const source = readObject(resources);
  return {
    cpu: cleanNumber(source.cpu),
    gpu: cleanNumber(source.gpu),
    ramGb: cleanNumber(source.ramGb),
    timeoutMin: cleanNumber(source.timeoutMin),
  };
}

function buildRunExecutionView(run = {}) {
  const metadata = readObject(run?.metadata);
  const jobSpec = readObject(metadata.jobSpec);
  const serverId = cleanString(run?.serverId) || 'local-default';
  const location = serverId === 'local-default' ? 'local' : 'remote';
  const backend = cleanString(jobSpec.backend || metadata.executionBackend)
    || (location === 'local' ? 'local' : '');
  const runtimeClass = cleanString(jobSpec.runtimeClass || metadata.runtimeClass);
  return {
    serverId,
    location,
    mode: cleanString(run?.mode) || 'interactive',
    backend,
    runtimeClass,
    resources: normalizeResources(jobSpec.resources || metadata.resources),
  };
}

module.exports = {
  buildRunExecutionView,
};
