'use strict';

const { buildRunListItem } = require('./run-list-payload.service');

function normalizeRunTreeNode(node = {}) {
  const item = buildRunListItem(node);
  return {
    ...item,
    children: (Array.isArray(node?.children) ? node.children : []).map((child) => normalizeRunTreeNode(child)),
  };
}

function buildRunTreePayload({ roots = [], total = 0 } = {}) {
  return {
    tree: (Array.isArray(roots) ? roots : []).map((item) => normalizeRunTreeNode(item)),
    total: Number.isFinite(Number(total)) ? Number(total) : 0,
  };
}

module.exports = {
  buildRunTreePayload,
  normalizeRunTreeNode,
};
