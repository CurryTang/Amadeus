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

function hasAnyResource(resources = {}) {
  return Object.values(resources).some((value) => value !== null);
}

function buildJobSpec(payload = {}) {
  const explicitJobSpec = readObject(payload.jobSpec);
  const explicitResources = normalizeResources(explicitJobSpec.resources || {});
  const fallbackResources = normalizeResources(payload.resources || {});
  const mergedResources = {
    cpu: fallbackResources.cpu ?? explicitResources.cpu,
    gpu: fallbackResources.gpu ?? explicitResources.gpu,
    ramGb: fallbackResources.ramGb ?? explicitResources.ramGb,
    timeoutMin: fallbackResources.timeoutMin ?? explicitResources.timeoutMin,
  };
  const backend = cleanString(explicitJobSpec.backend || payload.backend);
  const runtimeClass = cleanString(explicitJobSpec.runtimeClass || payload.runtimeClass);

  if (!backend && !runtimeClass && !hasAnyResource(mergedResources)) {
    return null;
  }

  return {
    ...(backend ? { backend } : {}),
    ...(runtimeClass ? { runtimeClass } : {}),
    resources: mergedResources,
  };
}

function normalizeEnqueueRunPayload(input = {}) {
  const payload = readObject(input);
  const metadata = readObject(payload.metadata);
  const jobSpec = buildJobSpec(payload);
  return {
    ...payload,
    serverId: cleanString(payload.serverId) || 'local-default',
    mode: cleanString(payload.mode).toLowerCase() === 'interactive' ? 'interactive' : 'headless',
    metadata: {
      ...metadata,
      ...(jobSpec ? { jobSpec } : {}),
    },
  };
}

module.exports = {
  normalizeEnqueueRunPayload,
};
