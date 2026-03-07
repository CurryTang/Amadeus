'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((item) => cleanString(item)).filter(Boolean))];
}

function buildThinRunOutputView(run = {}) {
  const highlights = asObject(run?.highlights);
  const deliverableArtifactIds = uniqueStrings(highlights.deliverableArtifactIds);
  const summaryArtifactId = cleanString(highlights.summaryArtifactId) || null;
  const finalOutputArtifactId = cleanString(highlights.finalOutputArtifactId) || null;
  const hasSummary = Boolean(cleanString(run?.summary) || summaryArtifactId);
  const hasFinalOutput = Boolean(finalOutputArtifactId);

  return {
    hasSummary,
    hasFinalOutput,
    deliverableArtifactIds,
    summaryArtifactId,
    finalOutputArtifactId,
  };
}

module.exports = {
  buildThinRunOutputView,
};
