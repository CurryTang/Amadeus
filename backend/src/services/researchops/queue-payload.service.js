'use strict';

const { buildRunListItem } = require('./run-list-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildQueueListPayload({
  items = [],
  serverId = '',
  limit = null,
} = {}) {
  return {
    filters: {
      serverId: cleanString(serverId) || null,
    },
    limit: Number.isFinite(Number(limit)) ? Number(limit) : null,
    items: (Array.isArray(items) ? items : []).map((item) => buildRunListItem(item)),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/scheduler/queue',
      },
    },
  };
}

module.exports = {
  buildQueueListPayload,
};
