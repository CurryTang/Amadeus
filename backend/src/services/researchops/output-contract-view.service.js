'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTokenList(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((item) => cleanString(item))
      .filter(Boolean)
  )];
}

function buildRunOutputContractView(run = {}, manifest = null) {
  const outputContract = asObject(run?.outputContract);
  const contractValidation = asObject(asObject(manifest).contractValidation);
  return {
    requiredArtifacts: normalizeTokenList(outputContract.requiredArtifacts),
    tables: normalizeTokenList(outputContract.tables),
    figures: normalizeTokenList(outputContract.figures),
    metricKeys: normalizeTokenList(outputContract.metricKeys),
    summaryRequired: Boolean(outputContract.summaryRequired),
    ok: typeof contractValidation.ok === 'boolean' ? contractValidation.ok : null,
    missingTables: normalizeTokenList(contractValidation.missingTables),
    missingFigures: normalizeTokenList(contractValidation.missingFigures),
  };
}

module.exports = {
  buildRunOutputContractView,
};
