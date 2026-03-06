import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildTreeExecutionSummary, getPrimaryTreeAction } from './treeExecutionSummary.js';

const EXECUTED_STATUSES = new Set(['RUNNING', 'PASSED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'STALE']);

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getNodeStatus(nodeId, treeState) {
  return cleanString(treeState?.nodes?.[nodeId]?.status).toUpperCase() || 'PLANNED';
}

function getLod(zoom = 1) {
  if (zoom < 0.5) return 'far';
  if (zoom < 0.85) return 'mid';
  return 'near';
}

function computeFramedCamera(bounds = {}, viewport = {}) {
  const width = Number(viewport?.width || 0);
  const height = Number(viewport?.height || 0);
  if (width <= 2 || height <= 2) return null;
  const safeMinX = Number.isFinite(Number(bounds?.minX)) ? Number(bounds.minX) : 0;
  const safeMinY = Number.isFinite(Number(bounds?.minY)) ? Number(bounds.minY) : 0;
  const safeMaxX = Number.isFinite(Number(bounds?.maxX)) ? Number(bounds.maxX) : 0;
  const safeMaxY = Number.isFinite(Number(bounds?.maxY)) ? Number(bounds.maxY) : 0;
  const worldW = Math.max((safeMaxX - safeMinX) + 420, 480);
  const worldH = Math.max((safeMaxY - safeMinY) + 260, 320);
  const zoomX = width / worldW;
  const zoomY = height / worldH;
  const nextZoom = Math.min(Math.max(Math.min(zoomX, zoomY), 0.28), 1.2);
  const centerX = (safeMinX + safeMaxX) * 0.5;
  const centerY = (safeMinY + safeMaxY) * 0.5;
  return {
    zoom: nextZoom,
    x: width * 0.5 - centerX * nextZoom,
    y: height * 0.5 - centerY * nextZoom,
  };
}

function VibeTreeCanvas({
  plan,
  treeState,
  mode,
  selectedNodeId,
  onSelectNode,
  onNodeAction,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const workerRef = useRef(null);
  const autoFramedRef = useRef(false);
  const [layout, setLayout] = useState({ nodes: [], edges: [], bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 } });
  const [camera, setCamera] = useState({ x: 40, y: 36, zoom: 1 });
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef({ active: false, startX: 0, startY: 0, baseX: 0, baseY: 0 });

  const nodeById = useMemo(() => {
    const map = new Map();
    layout.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [layout.nodes]);

  useEffect(() => {
    const worker = new Worker(new URL('../../workers/treeLayout.worker.js', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const payload = event?.data && typeof event.data === 'object' ? event.data : {};
      if (!payload.ok) return;
      setLayout({
        nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
        edges: Array.isArray(payload.edges) ? payload.edges : [],
        bounds: payload.bounds || { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      });
    };
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
    autoFramedRef.current = false;
    const prevPositions = {};
    layout.nodes.forEach((node) => {
      prevPositions[node.id] = { x: node.x, y: node.y };
    });
    worker.postMessage({
      nodes,
      prevPositions,
      spacing: {
        hGap: 286,
        vGap: 162,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.nodes]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      setViewport({
        width: Math.max(Math.floor(rect.width), 1),
        height: Math.max(Math.floor(rect.height), 1),
      });
    };
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const toScreen = useCallback((x, y) => ({
    x: x * camera.zoom + camera.x,
    y: y * camera.zoom + camera.y,
  }), [camera]);

  const toWorld = useCallback((sx, sy) => ({
    x: (sx - camera.x) / camera.zoom,
    y: (sy - camera.y) / camera.zoom,
  }), [camera]);

  const lod = getLod(camera.zoom);
  const nodeWidth = lod === 'far' ? 12 : lod === 'mid' ? 206 : 268;
  const nodeHeight = lod === 'far' ? 12 : lod === 'mid' ? 74 : 116;

  const statusSummary = useMemo(
    () => buildTreeExecutionSummary(plan, treeState),
    [plan, treeState]
  );

  const visibleNodes = useMemo(() => {
    const margin = 220;
    return layout.nodes.filter((node) => {
      const screen = toScreen(node.x, node.y);
      const left = screen.x - nodeWidth / 2;
      const top = screen.y - nodeHeight / 2;
      return !(
        left > viewport.width + margin
        || top > viewport.height + margin
        || left + nodeWidth < -margin
        || top + nodeHeight < -margin
      );
    });
  }, [layout.nodes, nodeHeight, nodeWidth, toScreen, viewport.height, viewport.width]);

  useEffect(() => {
    if (autoFramedRef.current) return;
    if (!layout.nodes.length) return;
    const framed = computeFramedCamera(layout.bounds, viewport);
    if (!framed) return;
    setCamera(framed);
    autoFramedRef.current = true;
  }, [layout.bounds, layout.nodes.length, viewport.height, viewport.width]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.lineWidth = 1.15;

    const selectedId = cleanString(selectedNodeId);

    layout.edges.forEach((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      if (!from || !to) return;

      const fromVisible = visibleNodeIds.has(from.id);
      const toVisible = visibleNodeIds.has(to.id);
      if (!fromVisible && !toVisible) return;

      const a = toScreen(from.x, from.y);
      const b = toScreen(to.x, to.y);
      const ctrlY = a.y + (b.y - a.y) * 0.5;

      if (edge.kind === 'evidence') {
        const related = selectedId && (edge.from === selectedId || edge.to === selectedId);
        if (!related) return;
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = 'rgba(183, 132, 36, 0.86)';
      } else {
        ctx.setLineDash([3, 4]);
        const onActive = selectedId && (edge.from === selectedId || edge.to === selectedId);
        ctx.strokeStyle = onActive ? 'rgba(33, 75, 131, 0.9)' : 'rgba(21, 40, 62, 0.3)';
      }

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(a.x, ctrlY, b.x, ctrlY, b.x, b.y);
      ctx.stroke();
    });

    ctx.setLineDash([]);
  }, [layout.edges, nodeById, selectedNodeId, toScreen, viewport.height, viewport.width, visibleNodeIds]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('.vibe-tree-node') || target?.closest('.vibe-tree-node-actions')) return;
    dragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      baseX: camera.x,
      baseY: camera.y,
    };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    if (!dragRef.current.active) return;
    const deltaX = event.clientX - dragRef.current.startX;
    const deltaY = event.clientY - dragRef.current.startY;
    setCamera((prev) => ({
      ...prev,
      x: dragRef.current.baseX + deltaX,
      y: dragRef.current.baseY + deltaY,
    }));
  };

  const onPointerUp = () => {
    dragRef.current.active = false;
    setDragging(false);
  };

  const onWheel = (event) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const world = toWorld(mouseX, mouseY);
    const zoomDelta = event.deltaY > 0 ? -0.08 : 0.08;
    const nextZoom = Math.min(Math.max(camera.zoom + zoomDelta, 0.24), 2.2);

    setCamera((prev) => ({
      zoom: nextZoom,
      x: mouseX - world.x * nextZoom,
      y: mouseY - world.y * nextZoom,
    }));
  };

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) || null : null;
  const canResetView = layout.nodes.length > 0;
  const resetView = () => {
    const framed = computeFramedCamera(layout.bounds, viewport);
    if (!framed) return;
    setCamera(framed);
    autoFramedRef.current = true;
  };

  return (
    <section className="vibe-tree-canvas-wrap">
      <div className="vibe-tree-canvas-toolbar">
        <div className="vibe-tree-toolbar-tabs">
          <span className="vibe-tree-toolbar-tab is-active">Canvas <em>{layout.nodes.length}</em></span>
          <span className="vibe-tree-toolbar-tab">Running <em>{statusSummary.running}</em></span>
          <span className="vibe-tree-toolbar-tab">Needs Review <em>{statusSummary.needsReview}</em></span>
          <span className="vibe-tree-toolbar-tab">Done <em>{statusSummary.done}</em></span>
          <span className="vibe-tree-toolbar-tab">Failed <em>{statusSummary.failed}</em></span>
        </div>
        <div className="vibe-tree-toolbar-meta">
          <span>{layout.edges.length} links</span>
          <span>{dragging ? 'panning' : `zoom ${camera.zoom.toFixed(2)}x`}</span>
          <button type="button" className="vibe-tree-toolbar-btn" onClick={resetView} disabled={!canResetView}>
            Reset View
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="vibe-tree-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} />

        <div className="vibe-tree-node-layer">
          {visibleNodes.map((node) => {
            const screen = toScreen(node.x, node.y);
            const status = getNodeStatus(node.id, treeState);
            const nodeState = treeState?.nodes?.[node.id] || {};
            const executed = EXECUTED_STATUSES.has(status);
            const isSelected = node.id === selectedNodeId;
            const isObserved = cleanString(node.kind).toLowerCase() === 'observed_agent';
            const hasTarget = Array.isArray(node.target) && node.target.length > 0;
            const commandCount = Array.isArray(node.commands) ? node.commands.length : 0;
            const checkCount = Array.isArray(node.checks) ? node.checks.length : 0;
            const kindLabel = isObserved
              ? 'OBSERVED'
              : cleanString(node.kind || 'topic').slice(0, 16).toUpperCase();
            const nextAction = getPrimaryTreeAction(node, nodeState);

            return (
              <button
                key={node.id}
                type="button"
                className={`vibe-tree-node vibe-tree-node--${lod}${isSelected ? ' is-selected' : ''}${isObserved ? ' is-observed' : ''}`}
                style={{
                  width: `${nodeWidth}px`,
                  height: `${nodeHeight}px`,
                  transform: `translate(${Math.round(screen.x - nodeWidth / 2)}px, ${Math.round(screen.y - nodeHeight / 2)}px)`,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectNode?.(node.id);
                }}
              >
                {lod !== 'far' && (
                  <>
                    <div className="vibe-tree-node-head">
                      <span className="vibe-tree-node-kind">{kindLabel || 'TOPIC'}</span>
                      <span className={`vibe-tree-status-dot is-${status.toLowerCase()}`} />
                      <span className="vibe-tree-node-meta">{status}{executed ? ' · locked' : ''}</span>
                    </div>
                    <span className="vibe-tree-node-title" title={node.title}>{node.title || node.id}</span>
                    {(lod === 'near' && hasTarget) && (
                      <span className="vibe-tree-node-subtitle" title={String(node.target[0])}>{String(node.target[0])}</span>
                    )}
                    {lod === 'near' && (
                      <div className="vibe-tree-node-footer">
                        <span className="vibe-tree-node-op">{nextAction}</span>
                        <span className="vibe-tree-node-op">{commandCount} cmd · {checkCount} checks</span>
                      </div>
                    )}
                  </>
                )}
                {lod === 'far' && (
                  <span className={`vibe-tree-status-dot is-${status.toLowerCase()}`} />
                )}
              </button>
            );
          })}
        </div>

        {selectedNode && lod !== 'far' && (
          <div
            className="vibe-tree-node-actions"
            style={{
              transform: (() => {
                const screen = toScreen(selectedNode.x, selectedNode.y);
                const actionY = screen.y + nodeHeight / 2 + 10;
                return `translate(${Math.round(screen.x - nodeWidth / 2)}px, ${Math.round(actionY)}px)`;
              })(),
            }}
          >
            {!EXECUTED_STATUSES.has(getNodeStatus(selectedNode.id, treeState)) && mode === 'edit' ? (
              <>
                <button type="button" onClick={() => onNodeAction?.('add_child', selectedNode)}>+Child</button>
                <button type="button" onClick={() => onNodeAction?.('add_branch', selectedNode)}>+Branch</button>
                <button type="button" onClick={() => onNodeAction?.('insert', selectedNode)}>Insert</button>
                <button type="button" onClick={() => onNodeAction?.('duplicate', selectedNode)}>Duplicate</button>
                <button type="button" onClick={() => onNodeAction?.('convert_search', selectedNode)}>Convert</button>
              </>
            ) : (
              <>
                {(() => {
                  const nodeState = treeState?.nodes?.[selectedNode.id] || {};
                  const hasManualGate = Array.isArray(selectedNode.checks)
                    && selectedNode.checks.some((c) => c?.type === 'manual_approve');
                  const gateApproved = Boolean(nodeState.manualApproved);
                  return hasManualGate && !gateApproved ? (
                    <button
                      type="button"
                      style={{ background: 'var(--vibe-warn, #f59e0b)', color: '#fff' }}
                      onClick={() => onNodeAction?.('approve_gate', selectedNode)}
                    >
                      Approve Gate
                    </button>
                  ) : null;
                })()}
                <button type="button" onClick={() => onNodeAction?.('run_step', selectedNode)}>Run Step</button>
                <button type="button" onClick={() => onNodeAction?.('run_step_preflight', selectedNode)}>Preflight</button>
                <button type="button" onClick={() => onNodeAction?.('run_step_force', selectedNode)}>Force</button>
                <button type="button" onClick={() => onNodeAction?.('rerun', selectedNode)}>Rerun</button>
                <button type="button" onClick={() => onNodeAction?.('create_patch_node', selectedNode)}>Create Patch Node</button>
                {selectedNode.kind === 'search' && (
                  <button type="button" onClick={() => onNodeAction?.('promote', selectedNode)}>Promote</button>
                )}
                <button type="button" onClick={() => onNodeAction?.('continue_from', selectedNode)}>Continue From</button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default VibeTreeCanvas;
