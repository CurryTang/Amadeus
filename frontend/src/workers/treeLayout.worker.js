const H_GAP_DEFAULT = 320;
const V_GAP_DEFAULT = 108;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function buildGraph(nodes = []) {
  const byId = new Map();
  const children = new Map();
  const evidenceDeps = [];

  nodes.forEach((node, index) => {
    const id = cleanString(node?.id) || `node_${index + 1}`;
    const normalized = {
      ...node,
      id,
      parent: cleanString(node?.parent),
      activeChild: cleanString(node?.activeChild),
      evidenceDeps: Array.isArray(node?.evidenceDeps)
        ? node.evidenceDeps.map((item) => cleanString(item)).filter(Boolean)
        : [],
    };
    byId.set(id, normalized);
    if (!children.has(id)) children.set(id, []);
  });

  byId.forEach((node) => {
    if (node.parent && byId.has(node.parent)) {
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(node.id);
    }
    node.evidenceDeps.forEach((depId) => {
      if (depId && byId.has(depId) && depId !== node.id) {
        evidenceDeps.push({ from: depId, to: node.id });
      }
    });
  });

  const roots = [...byId.values()]
    .filter((node) => !node.parent || !byId.has(node.parent))
    .map((node) => node.id);

  if (roots.length === 0 && byId.size > 0) {
    roots.push([...byId.keys()][0]);
  }

  return { byId, children, roots, evidenceDeps };
}

function layoutTree({ nodes = [], spacing = {}, prevPositions = {} } = {}) {
  const hGap = toNumber(spacing?.hGap, H_GAP_DEFAULT);
  const vGap = toNumber(spacing?.vGap, V_GAP_DEFAULT);

  const { byId, children, roots, evidenceDeps } = buildGraph(nodes);

  let nextX = 0;
  const positions = new Map();
  const visited = new Set();

  function assign(nodeId, depth = 0) {
    if (!nodeId || visited.has(nodeId)) return;
    visited.add(nodeId);

    const childIds = (children.get(nodeId) || []).filter((id) => !visited.has(id));
    if (childIds.length === 0) {
      positions.set(nodeId, {
        x: nextX * hGap,
        y: depth * vGap,
        depth,
      });
      nextX += 1;
      return;
    }

    childIds.forEach((childId) => assign(childId, depth + 1));
    const childPositions = childIds
      .map((childId) => positions.get(childId))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);

    const centerX = childPositions.length
      ? (childPositions[0].x + childPositions[childPositions.length - 1].x) / 2
      : nextX * hGap;

    positions.set(nodeId, {
      x: centerX,
      y: depth * vGap,
      depth,
    });
  }

  roots.forEach((rootId) => {
    assign(rootId, 0);
    nextX += 1;
  });

  byId.forEach((_, nodeId) => {
    if (!positions.has(nodeId)) assign(nodeId, 0);
  });

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const positionedNodes = [...byId.values()].map((node) => {
    const pos = positions.get(node.id) || {
      x: 0,
      y: 0,
      depth: 0,
    };

    const prev = prevPositions && typeof prevPositions === 'object' ? prevPositions[node.id] : null;
    const blendedX = prev && Number.isFinite(Number(prev.x)) ? (Number(prev.x) * 0.35 + pos.x * 0.65) : pos.x;
    const blendedY = prev && Number.isFinite(Number(prev.y)) ? (Number(prev.y) * 0.35 + pos.y * 0.65) : pos.y;

    minX = Math.min(minX, blendedX);
    minY = Math.min(minY, blendedY);
    maxX = Math.max(maxX, blendedX);
    maxY = Math.max(maxY, blendedY);

    return {
      ...node,
      x: blendedX,
      y: blendedY,
      depth: pos.depth,
    };
  });

  const parentEdges = positionedNodes
    .filter((node) => node.parent && byId.has(node.parent))
    .map((node) => ({
      from: node.parent,
      to: node.id,
      kind: 'parent',
    }));

  const allEdges = [...parentEdges, ...evidenceDeps.map((edge) => ({ ...edge, kind: 'evidence' }))];

  return {
    nodes: positionedNodes,
    edges: allEdges,
    bounds: {
      minX: Number.isFinite(minX) ? minX : 0,
      minY: Number.isFinite(minY) ? minY : 0,
      maxX: Number.isFinite(maxX) ? maxX : 0,
      maxY: Number.isFinite(maxY) ? maxY : 0,
    },
  };
}

self.onmessage = (event) => {
  const payload = event?.data && typeof event.data === 'object' ? event.data : {};
  try {
    const result = layoutTree(payload);
    self.postMessage({ ok: true, ...result });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: String(error?.message || 'layout failed'),
      nodes: [],
      edges: [],
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    });
  }
};
