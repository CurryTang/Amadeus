'use strict';

const { buildExecutionRuntimeCatalog } = require('./runtime-catalog.service');

function buildRuntimeCatalogPayload({
  refreshedAt = '',
} = {}) {
  const catalog = buildExecutionRuntimeCatalog();
  return {
    refreshedAt: String(refreshedAt || '').trim() || new Date().toISOString(),
    ...catalog,
    actions: {
      catalog: {
        method: 'GET',
        path: '/researchops/runtime/catalog',
      },
      overview: {
        method: 'GET',
        path: '/researchops/runtime/overview',
      },
    },
  };
}

module.exports = {
  buildRuntimeCatalogPayload,
};
