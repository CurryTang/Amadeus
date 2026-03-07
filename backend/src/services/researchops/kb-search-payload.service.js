'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildKbSearchPayload({
  query = '',
  topK = null,
  result = null,
} = {}) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return {
    query: cleanString(query) || null,
    topK: Number.isFinite(Number(topK)) ? Number(topK) : null,
    source: cleanString(source.source) || null,
    items: Array.isArray(source.items) ? source.items : [],
    actions: {
      search: {
        method: 'POST',
        path: '/researchops/kb/search',
      },
    },
  };
}

module.exports = {
  buildKbSearchPayload,
};
