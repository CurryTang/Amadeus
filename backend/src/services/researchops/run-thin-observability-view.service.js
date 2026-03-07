'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanNonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildThinRunObservabilityView(run = {}) {
  const source = asObject(run?.observability);
  const counts = asObject(source.counts);
  const statuses = asObject(source.statuses);
  const sinkProviders = asArray(source.sinkProviders).map((item) => cleanString(item)).filter(Boolean);
  const warnings = asArray(source.warnings).map((item) => cleanString(item)).filter(Boolean);

  const normalized = {
    counts: {
      ...(cleanNonNegativeInteger(counts.warnings) !== null ? { warnings: cleanNonNegativeInteger(counts.warnings) } : {}),
      ...(cleanNonNegativeInteger(counts.sinks) !== null ? { sinks: cleanNonNegativeInteger(counts.sinks) } : {}),
    },
    statuses: {
      ...(cleanString(statuses.readiness) ? { readiness: cleanString(statuses.readiness) } : {}),
      ...(cleanString(statuses.contract) ? { contract: cleanString(statuses.contract) } : {}),
    },
    ...(sinkProviders.length > 0 ? { sinkProviders } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  if (Object.keys(normalized.counts).length === 0) delete normalized.counts;
  if (Object.keys(normalized.statuses).length === 0) delete normalized.statuses;

  return Object.keys(normalized).length > 0 ? normalized : null;
}

module.exports = {
  buildThinRunObservabilityView,
};
