function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeNodeId(input = '') {
  return cleanString(input);
}

function normalizeNode(node = {}, index = 0) {
  const normalized = {
    id: normalizeNodeId(node.id) || `node_${index + 1}`,
    parent: normalizeNodeId(node.parent || ''),
    title: cleanString(node.title) || `Node ${index + 1}`,
    kind: cleanString(node.kind) || 'experiment',
    assumption: Array.isArray(node.assumption) ? node.assumption.map((item) => cleanString(item)).filter(Boolean) : [],
    target: Array.isArray(node.target) ? node.target.map((item) => cleanString(item)).filter(Boolean) : [],
    commands: Array.isArray(node.commands) ? node.commands : [],
    checks: Array.isArray(node.checks) ? node.checks : [],
    evidenceDeps: Array.isArray(node.evidenceDeps)
      ? node.evidenceDeps.map((item) => normalizeNodeId(item)).filter(Boolean)
      : [],
    resources: node.resources && typeof node.resources === 'object' ? node.resources : {},
    on_fail: node.on_fail && typeof node.on_fail === 'object' ? node.on_fail : {},
    git: node.git && typeof node.git === 'object' ? node.git : {},
    ui: node.ui && typeof node.ui === 'object' ? node.ui : {},
    tags: Array.isArray(node.tags) ? node.tags.map((item) => cleanString(item)).filter(Boolean) : [],
    activeChild: normalizeNodeId(node.activeChild || ''),
    search: node.search && typeof node.search === 'object' ? node.search : undefined,
  };
  if (!normalized.parent) delete normalized.parent;
  if (!normalized.activeChild) delete normalized.activeChild;
  if (!normalized.search) delete normalized.search;
  return normalized;
}

function normalizePlan(plan = {}) {
  const rawNodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const normalizedNodes = rawNodes.map((node, index) => normalizeNode(node, index));
  return {
    version: Number(plan.version) || 1,
    project: cleanString(plan.project) || 'AutoResearch',
    vars: plan.vars && typeof plan.vars === 'object' ? plan.vars : {},
    nodes: normalizedNodes,
  };
}

function buildNodeMap(nodes = []) {
  const byId = new Map();
  nodes.forEach((node, index) => {
    const id = normalizeNodeId(node.id) || `node_${index + 1}`;
    byId.set(id, { ...node, id });
  });
  return byId;
}

function findNode(nodes = [], nodeId = '') {
  const id = normalizeNodeId(nodeId);
  if (!id) return null;
  return nodes.find((item) => normalizeNodeId(item.id) === id) || null;
}

function getLockedStatuses() {
  return new Set(['RUNNING', 'PASSED', 'FAILED', 'SKIPPED', 'STALE']);
}

function assertNodeEditable(state = {}, nodeId = '') {
  const id = normalizeNodeId(nodeId);
  if (!id) return;
  const nodeState = state?.nodes && typeof state.nodes === 'object' ? state.nodes[id] : null;
  const status = cleanString(nodeState?.status).toUpperCase();
  if (!status) return;
  if (getLockedStatuses().has(status)) {
    const error = new Error(`Node ${id} is immutable because status=${status}`);
    error.code = 'PLAN_PATCH_CONFLICT';
    error.details = { nodeId: id, status };
    throw error;
  }
}

function setByPath(target, path, value) {
  const segments = String(path || '')
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

function removeByPath(target, path) {
  const segments = String(path || '')
    .split('.')
    .map((item) => item.trim())
    .filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i];
    if (!cursor[key] || typeof cursor[key] !== 'object') return;
    cursor = cursor[key];
  }
  delete cursor[segments[segments.length - 1]];
}

function validatePlanGraph(plan = {}) {
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const errors = [];
  const warnings = [];
  const byId = new Map();

  nodes.forEach((node) => {
    const id = normalizeNodeId(node.id);
    if (!id) {
      errors.push({ code: 'NODE_ID_MISSING', message: 'Node id is required' });
      return;
    }
    if (byId.has(id)) {
      errors.push({ code: 'NODE_ID_DUPLICATE', message: `Duplicate node id: ${id}`, nodeId: id });
      return;
    }
    byId.set(id, node);
  });

  nodes.forEach((node) => {
    const id = normalizeNodeId(node.id);
    const parent = normalizeNodeId(node.parent || '');
    if (parent && !byId.has(parent)) {
      errors.push({
        code: 'PARENT_NOT_FOUND',
        message: `Node ${id} references missing parent ${parent}`,
        nodeId: id,
      });
    }

    const evidenceDeps = Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [];
    evidenceDeps.forEach((depIdRaw) => {
      const depId = normalizeNodeId(depIdRaw);
      if (!depId) return;
      if (!byId.has(depId)) {
        errors.push({
          code: 'EVIDENCE_DEP_NOT_FOUND',
          message: `Node ${id} references missing evidence dep ${depId}`,
          nodeId: id,
        });
      }
      if (depId === id) {
        errors.push({
          code: 'EVIDENCE_SELF_LOOP',
          message: `Node ${id} cannot depend on itself`,
          nodeId: id,
        });
      }
    });
  });

  const adjacency = new Map();
  const indegree = new Map();
  byId.forEach((_, id) => {
    adjacency.set(id, []);
    indegree.set(id, 0);
  });

  byId.forEach((node, id) => {
    const parent = normalizeNodeId(node.parent || '');
    if (parent && byId.has(parent)) {
      adjacency.get(parent).push(id);
      indegree.set(id, (indegree.get(id) || 0) + 1);
    }
  });

  byId.forEach((node, id) => {
    const deps = Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [];
    deps.forEach((depRaw) => {
      const dep = normalizeNodeId(depRaw);
      if (!dep || !byId.has(dep)) return;
      adjacency.get(dep).push(id);
      indegree.set(id, (indegree.get(id) || 0) + 1);
    });
  });

  const queue = [];
  indegree.forEach((value, id) => {
    if (value === 0) queue.push(id);
  });
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    visited += 1;
    const nextList = adjacency.get(current) || [];
    nextList.forEach((nextId) => {
      const next = (indegree.get(nextId) || 0) - 1;
      indegree.set(nextId, next);
      if (next === 0) queue.push(nextId);
    });
  }
  if (visited !== byId.size) {
    errors.push({ code: 'PLAN_CYCLE_DETECTED', message: 'Plan graph contains a cycle' });
  }

  byId.forEach((node, id) => {
    if (node.kind === 'search' && !node.search) {
      warnings.push({
        code: 'SEARCH_CONFIG_MISSING',
        message: `Search node ${id} has no search block; defaults will be applied`,
        nodeId: id,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function applyPlanPatch(planInput, patch = {}, state = {}) {
  const plan = normalizePlan(clone(planInput || {}));
  const op = cleanString(patch.op).toLowerCase();

  if (!op) {
    const error = new Error('Patch op is required');
    error.code = 'PLAN_PATCH_INVALID';
    throw error;
  }

  if (op === 'add_node') {
    const node = normalizeNode(patch.node || {}, plan.nodes.length);
    if (!node.id) {
      const error = new Error('Patch add_node requires node.id');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    if (findNode(plan.nodes, node.id)) {
      const error = new Error(`Node already exists: ${node.id}`);
      error.code = 'PLAN_PATCH_CONFLICT';
      throw error;
    }
    if (node.parent) {
      const parent = findNode(plan.nodes, node.parent);
      if (!parent) {
        const error = new Error(`Parent not found: ${node.parent}`);
        error.code = 'PLAN_PATCH_INVALID';
        throw error;
      }
      assertNodeEditable(state, node.parent);
    }
    plan.nodes.push(node);
    return normalizePlan(plan);
  }

  if (op === 'set_field') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const fieldPath = cleanString(patch.path);
    if (!nodeId || !fieldPath) {
      const error = new Error('Patch set_field requires nodeId and path');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    const node = findNode(plan.nodes, nodeId);
    if (!node) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    setByPath(node, fieldPath, patch.value);
    return normalizePlan(plan);
  }

  if (op === 'unset_field') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const fieldPath = cleanString(patch.path);
    if (!nodeId || !fieldPath) {
      const error = new Error('Patch unset_field requires nodeId and path');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    const node = findNode(plan.nodes, nodeId);
    if (!node) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    removeByPath(node, fieldPath);
    return normalizePlan(plan);
  }

  if (op === 'move_node') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const nextParent = normalizeNodeId(patch.parentId || '');
    if (!nodeId) {
      const error = new Error('Patch move_node requires nodeId');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    if (nextParent) assertNodeEditable(state, nextParent);
    const node = findNode(plan.nodes, nodeId);
    if (!node) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    if (nextParent && !findNode(plan.nodes, nextParent)) {
      const error = new Error(`Parent not found: ${nextParent}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    node.parent = nextParent || undefined;
    return normalizePlan(plan);
  }

  if (op === 'add_dep') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const depId = normalizeNodeId(patch.depId);
    if (!nodeId || !depId) {
      const error = new Error('Patch add_dep requires nodeId and depId');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    const node = findNode(plan.nodes, nodeId);
    if (!node) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    if (!findNode(plan.nodes, depId)) {
      const error = new Error(`Dependency node not found: ${depId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    if (!Array.isArray(node.evidenceDeps)) node.evidenceDeps = [];
    if (!node.evidenceDeps.includes(depId)) node.evidenceDeps.push(depId);
    return normalizePlan(plan);
  }

  if (op === 'remove_dep') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const depId = normalizeNodeId(patch.depId);
    if (!nodeId || !depId) {
      const error = new Error('Patch remove_dep requires nodeId and depId');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    const node = findNode(plan.nodes, nodeId);
    if (!node) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    const deps = Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [];
    node.evidenceDeps = deps.filter((item) => normalizeNodeId(item) !== depId);
    return normalizePlan(plan);
  }

  if (op === 'set_active_child') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const childId = normalizeNodeId(patch.childId);
    if (!nodeId || !childId) {
      const error = new Error('Patch set_active_child requires nodeId and childId');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    const node = findNode(plan.nodes, nodeId);
    const child = findNode(plan.nodes, childId);
    if (!node || !child) {
      const error = new Error('Node/child not found');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    if (normalizeNodeId(child.parent || '') !== nodeId) {
      const error = new Error('Active child must be direct child of node');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    node.activeChild = childId;
    return normalizePlan(plan);
  }

  if (op === 'duplicate_node') {
    const nodeId = normalizeNodeId(patch.nodeId);
    const nextId = normalizeNodeId(patch.newNodeId);
    if (!nodeId || !nextId) {
      const error = new Error('Patch duplicate_node requires nodeId and newNodeId');
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    const source = findNode(plan.nodes, nodeId);
    if (!source) {
      const error = new Error(`Node not found: ${nodeId}`);
      error.code = 'PLAN_PATCH_INVALID';
      throw error;
    }
    assertNodeEditable(state, nodeId);
    if (findNode(plan.nodes, nextId)) {
      const error = new Error(`Node already exists: ${nextId}`);
      error.code = 'PLAN_PATCH_CONFLICT';
      throw error;
    }
    const clonedNode = normalizeNode({
      ...clone(source),
      id: nextId,
      title: `${source.title} (Copy)`,
    }, plan.nodes.length);
    plan.nodes.push(clonedNode);
    return normalizePlan(plan);
  }

  const error = new Error(`Unsupported patch op: ${op}`);
  error.code = 'PLAN_PATCH_INVALID';
  throw error;
}

function applyPlanPatches(planInput, patches = [], state = {}) {
  let plan = normalizePlan(planInput || {});
  const applied = [];
  for (const patch of Array.isArray(patches) ? patches : []) {
    plan = applyPlanPatch(plan, patch, state);
    applied.push({ op: patch.op, ok: true });
  }

  const validation = validatePlanGraph(plan);
  if (!validation.valid) {
    const error = new Error('Plan validation failed after patch application');
    error.code = 'PLAN_SCHEMA_INVALID';
    error.validation = validation;
    throw error;
  }

  return {
    plan,
    applied,
    validation,
  };
}

function calculateImpact(planBeforeInput, planAfterInput, state = {}) {
  const before = normalizePlan(planBeforeInput || {});
  const after = normalizePlan(planAfterInput || {});
  const beforeMap = buildNodeMap(before.nodes);
  const afterMap = buildNodeMap(after.nodes);

  const added = [];
  const removed = [];
  const changed = [];
  const immutableTouched = [];

  afterMap.forEach((node, id) => {
    if (!beforeMap.has(id)) {
      added.push(id);
      return;
    }
    const prev = beforeMap.get(id);
    const prevText = JSON.stringify(prev);
    const nextText = JSON.stringify(node);
    if (prevText !== nextText) {
      changed.push(id);
      const nodeState = state?.nodes && typeof state.nodes === 'object' ? state.nodes[id] : null;
      const status = cleanString(nodeState?.status).toUpperCase();
      if (getLockedStatuses().has(status)) {
        immutableTouched.push({ nodeId: id, status });
      }
    }
  });

  beforeMap.forEach((_, id) => {
    if (!afterMap.has(id)) removed.push(id);
  });

  const blocked = [];
  afterMap.forEach((node, id) => {
    const deps = [normalizeNodeId(node.parent || ''), ...(Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [])]
      .map((item) => normalizeNodeId(item))
      .filter(Boolean);
    for (const depId of deps) {
      const depState = state?.nodes && typeof state.nodes === 'object' ? state.nodes[depId] : null;
      const depStatus = cleanString(depState?.status).toUpperCase();
      if (!depStatus || !['PASSED'].includes(depStatus)) {
        blocked.push({ nodeId: id, blockedBy: depId, blockedStatus: depStatus || 'UNKNOWN' });
        break;
      }
    }
  });

  return {
    added,
    removed,
    changed,
    immutableTouched,
    blocked,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      blocked: blocked.length,
      immutableTouched: immutableTouched.length,
    },
  };
}

module.exports = {
  normalizePlan,
  validatePlanGraph,
  applyPlanPatch,
  applyPlanPatches,
  calculateImpact,
};
