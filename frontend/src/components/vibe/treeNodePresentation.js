function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isObservedTreeNode(node = {}) {
  return cleanString(node?.kind).toLowerCase() === 'observed_agent';
}

function isSearchTreeNode(node = {}) {
  return cleanString(node?.kind).toLowerCase() === 'search';
}

function hasManualGate(node = {}) {
  return Array.isArray(node?.checks)
    && node.checks.some((item) => cleanString(item?.type).toLowerCase() === 'manual_approve');
}

function getTreeNodeKindLabel(node = {}) {
  if (isObservedTreeNode(node)) return 'OBSERVED';
  const kind = cleanString(node?.kind);
  if (!kind) return 'TOPIC';
  return kind.slice(0, 16).toUpperCase();
}

export {
  getTreeNodeKindLabel,
  hasManualGate,
  isObservedTreeNode,
  isSearchTreeNode,
};
