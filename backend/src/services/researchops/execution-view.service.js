'use strict';

const {
  buildExecutionRuntimeProfile,
  normalizeExecutionBackend,
  normalizeRuntimeClass,
} = require('./runtime-catalog.service');

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

function hasAnyResource(resources = {}) {
  return Object.values(readObject(resources)).some((value) => value !== null);
}

function buildExecutionJobSpec(run = {}) {
  const metadata = readObject(run?.metadata);
  const jobSpec = readObject(metadata.jobSpec);
  const execution = buildRunExecutionView(run);
  const resources = normalizeResources(jobSpec.resources || execution.resources);
  const backend = normalizeExecutionBackend(execution.backend || jobSpec.backend);
  const runtimeClass = normalizeRuntimeClass(execution.runtimeClass || jobSpec.runtimeClass);
  if (!backend && !runtimeClass && !hasAnyResource(resources)) {
    return null;
  }
  return {
    ...(backend ? { backend } : {}),
    ...(runtimeClass ? { runtimeClass } : {}),
    resources,
  };
}

function buildRunExecutionView(run = {}) {
  const metadata = readObject(run?.metadata);
  const jobSpec = readObject(metadata.jobSpec);
  const serverId = cleanString(run?.serverId) || 'local-default';
  const location = serverId === 'local-default' ? 'local' : 'remote';
  const backend = normalizeExecutionBackend(jobSpec.backend || metadata.executionBackend)
    || (location === 'local' ? 'local' : '');
  const runtimeClass = normalizeRuntimeClass(jobSpec.runtimeClass || metadata.runtimeClass);
  const runtimeProfile = buildExecutionRuntimeProfile({
    backend,
    runtimeClass,
    location,
  });
  return {
    serverId,
    location,
    mode: cleanString(run?.mode) || 'interactive',
    backend,
    runtimeClass,
    runtimeProfile,
    resources: normalizeResources(jobSpec.resources || metadata.resources),
  };
}

module.exports = {
  buildExecutionJobSpec,
  buildRunExecutionView,
  normalizeResources,
};
