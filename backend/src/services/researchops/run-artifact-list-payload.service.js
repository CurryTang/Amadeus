'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isDeliverableKind(kind = '') {
  const normalized = cleanString(kind).toLowerCase();
  return normalized.startsWith('deliverable_');
}

function normalizeArtifact(runId = '', artifact = null) {
  const source = artifact && typeof artifact === 'object' ? artifact : {};
  const artifactId = cleanString(source.id);
  return {
    ...source,
    id: artifactId || null,
    kind: cleanString(source.kind) || null,
    title: cleanString(source.title) || null,
    isDeliverable: isDeliverableKind(source.kind),
    actions: artifactId && runId
      ? {
        download: {
          method: 'GET',
          path: `/researchops/runs/${runId}/artifacts/${artifactId}/download`,
        },
      }
      : {},
  };
}

function buildRunArtifactListPayload({
  runId = '',
  kind = '',
  items = [],
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    runId: safeRunId || null,
    filters: {
      kind: cleanString(kind) || null,
    },
    items: (Array.isArray(items) ? items : []).map((item) => normalizeArtifact(safeRunId, item)),
  };
}

module.exports = {
  buildRunArtifactListPayload,
};
