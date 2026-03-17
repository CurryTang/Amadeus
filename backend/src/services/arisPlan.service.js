const { getDb } = require('../db');

// ─── Plan node normalization ────────────────────────────────────────────────

function normalizePlanNode(row = {}) {
  if (!row || !row.id) return null;
  let dependsOn = [];
  try {
    const raw = row.dependsOn ?? row.depends_on ?? '[]';
    dependsOn = typeof raw === 'string' ? JSON.parse(raw) : (Array.isArray(raw) ? raw : []);
  } catch (_) { dependsOn = []; }

  return {
    id: row.id,
    runId: row.runId ?? row.run_id ?? '',
    nodeKey: row.nodeKey ?? row.node_key ?? '',
    title: row.title ?? '',
    description: row.description ?? '',
    status: row.status ?? 'pending',
    parentKey: row.parentKey ?? row.parent_key ?? null,
    dependsOn,
    canParallel: Boolean(row.canParallel ?? row.can_parallel),
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    startedAt: row.startedAt ?? row.started_at ?? null,
    completedAt: row.completedAt ?? row.completed_at ?? null,
    resultSummary: row.resultSummary ?? row.result_summary ?? '',
    createdAt: row.createdAt ?? row.created_at ?? null,
  };
}

// ─── Markdown plan parser ───────────────────────────────────────────────────
// Parses an implementation plan markdown into a flat list of plan nodes
// with dependency relationships.

function parsePlanMarkdown(markdown) {
  const lines = String(markdown || '').split('\n');
  const nodes = [];
  let currentStep = null;
  let currentTodo = null;
  let sortOrder = 0;
  let descriptionLines = [];

  // Track step-level dependencies from the priority/ordering section
  const stepOrder = []; // ordered list of step keys

  function flushTodo() {
    if (currentTodo) {
      currentTodo.description = descriptionLines.join('\n').trim();
      nodes.push(currentTodo);
      descriptionLines = [];
      currentTodo = null;
    }
  }

  function flushStep() {
    flushTodo();
    currentStep = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match step headers: ### Step N: Title (Week X)
    const stepMatch = line.match(/^###\s+(?:Step|Phase)\s+(\d+)\s*[:\-–—]\s*(.+?)(?:\s*\(.*\))?\s*$/i);
    if (stepMatch) {
      flushStep();
      const stepNum = stepMatch[1];
      const stepTitle = stepMatch[2].trim();
      const stepKey = `Step-${stepNum}`;
      currentStep = {
        key: stepKey,
        title: stepTitle,
        num: Number(stepNum),
      };
      stepOrder.push(stepKey);

      // Create a group node for the step
      sortOrder++;
      nodes.push({
        id: null, // will be assigned later
        nodeKey: stepKey,
        title: `Step ${stepNum}: ${stepTitle}`,
        description: '',
        status: 'pending',
        parentKey: null,
        dependsOn: [],
        canParallel: false,
        sortOrder,
      });
      continue;
    }

    // Match TODO items: #### TODO-N.M: Title
    const todoMatch = line.match(/^####\s+(TODO[- ]?\d+\.\d+\w?)\s*[:\-–—]\s*(.+?)\s*$/i);
    if (todoMatch) {
      flushTodo();
      const todoKey = todoMatch[1].replace(/\s+/g, '-').toUpperCase();
      const todoTitle = todoMatch[2].trim();
      sortOrder++;

      currentTodo = {
        id: null,
        nodeKey: todoKey,
        title: todoTitle,
        description: '',
        status: 'pending',
        parentKey: currentStep?.key ?? null,
        dependsOn: [],
        canParallel: false,
        sortOrder,
      };

      // Check if title contains ✅ marker (already done)
      if (/✅/.test(todoTitle) || /✅/.test(line)) {
        currentTodo.status = 'completed';
      }

      descriptionLines = [];
      continue;
    }

    // Accumulate description for current TODO
    if (currentTodo) {
      descriptionLines.push(line);
    }
  }

  flushStep();

  // ─── Infer dependencies ─────────────────────────────────────────────────
  // 1. Step-level: each step depends on the previous step (unless explicitly parallel)
  // 2. TODO-level: sequential TODOs within a step depend on prior TODO
  //    unless they share the same "sub-step" (e.g., 2.1, 2.2, 2.3 are parallel after 2.0)

  const stepNodes = nodes.filter(n => n.nodeKey.startsWith('Step-'));
  const todoNodes = nodes.filter(n => !n.nodeKey.startsWith('Step-'));

  // Step dependencies: Step N depends on Step N-1
  for (let i = 1; i < stepNodes.length; i++) {
    stepNodes[i].dependsOn = [stepNodes[i - 1].nodeKey];
  }

  // TODO dependencies within each step
  const todosByStep = {};
  for (const todo of todoNodes) {
    const stepKey = todo.parentKey || '_root';
    if (!todosByStep[stepKey]) todosByStep[stepKey] = [];
    todosByStep[stepKey].push(todo);
  }

  for (const [stepKey, todos] of Object.entries(todosByStep)) {
    if (todos.length <= 1) continue;

    // Parse TODO keys to understand structure
    // e.g., TODO-2.0, TODO-2.1, TODO-2.2, TODO-2.3, TODO-2.4, TODO-2.5, TODO-2.6
    // The X.0 is the foundation. X.1, X.2, X.3 are parallel (same integer prefix, different decimal).
    // X.5 depends on X.1-X.4 completing (it's a "wire up" step).
    // X.6 depends on X.5 (benchmark)

    // Group by major number
    const parsed = todos.map(t => {
      const m = t.nodeKey.match(/TODO-(\d+)\.(\d+)(\w?)/i);
      return {
        node: t,
        major: m ? Number(m[1]) : 0,
        minor: m ? Number(m[2]) : 0,
        suffix: m ? (m[3] || '') : '',
      };
    });

    // Sort by major, then minor
    parsed.sort((a, b) => a.major - b.major || a.minor - b.minor);

    // Find the base TODO (X.0) — everything else depends on it
    const baseTodo = parsed.find(p => p.minor === 0);

    // Group TODOs by their minor number pattern
    // Convention: TODOs with consecutive minor numbers after .0 that don't reference
    // each other are parallel. A TODO that's clearly a "wire up" or "benchmark" step
    // (like X.5, X.6) depends on all prior siblings.
    let prevKey = baseTodo?.node.nodeKey || null;
    const siblingKeys = [];

    for (const p of parsed) {
      if (p.minor === 0) {
        // Base TODO — depends on the step's prerequisite step
        continue;
      }

      // Heuristic: if title contains "wire", "benchmark", "run ... on", "sweep", "verify"
      // it likely depends on all prior siblings (aggregation step)
      const isAggregation = /wire|benchmark|run.*on|sweep|verify|expand/i.test(p.node.title);
      // Heuristic: if title contains "create", "implement", "add" + dataset/adapter/metric
      // it's likely independent work that can run in parallel
      const isIndependent = /create|implement|add|build/i.test(p.node.title)
        && /adapter|dataset|metric|module|component/i.test(p.node.title);

      if (isAggregation && siblingKeys.length > 0) {
        // Depends on ALL prior siblings
        p.node.dependsOn = [...siblingKeys];
        p.node.canParallel = false;
      } else if (baseTodo && p.minor > 0) {
        // Depends on base TODO, can run parallel with other non-aggregation siblings
        p.node.dependsOn = [baseTodo.node.nodeKey];
        p.node.canParallel = true;
      } else if (!baseTodo && (isIndependent || p.minor <= 3)) {
        // No base TODO — independent tasks can run in parallel (no deps within step)
        p.node.canParallel = true;
      } else if (prevKey) {
        p.node.dependsOn = [prevKey];
      }

      siblingKeys.push(p.node.nodeKey);
      if (!p.node.canParallel) {
        prevKey = p.node.nodeKey;
      }
    }
  }

  return nodes;
}

// ─── DB operations ──────────────────────────────────────────────────────────

async function savePlanNodes(runId, nodes) {
  const db = getDb();
  // Clear existing nodes for this run
  await db.execute({ sql: 'DELETE FROM aris_plan_nodes WHERE run_id = ?', args: [runId] });

  for (const node of nodes) {
    const id = node.id || `plan_${runId}_${node.nodeKey.replace(/[^a-zA-Z0-9]/g, '_')}`;
    await db.execute({
      sql: `INSERT OR REPLACE INTO aris_plan_nodes (
        id, run_id, node_key, title, description, status, parent_key,
        depends_on, can_parallel, sort_order, started_at, completed_at,
        result_summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id, runId, node.nodeKey, node.title, node.description || '',
        node.status || 'pending', node.parentKey || null,
        JSON.stringify(node.dependsOn || []), node.canParallel ? 1 : 0,
        node.sortOrder || 0, node.startedAt || null, node.completedAt || null,
        node.resultSummary || '', new Date().toISOString(),
      ],
    });
  }
}

async function getPlanNodes(runId) {
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM aris_plan_nodes WHERE run_id = ? ORDER BY sort_order ASC`,
    args: [runId],
  });
  return (result.rows || []).map(normalizePlanNode).filter(Boolean);
}

async function updatePlanNode(runId, nodeKey, updates = {}) {
  const db = getDb();

  // Build SET clause dynamically
  const sets = [];
  const args = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    args.push(updates.status);
    if (updates.status === 'running' && !updates.startedAt) {
      sets.push('started_at = ?');
      args.push(new Date().toISOString());
    }
    if ((updates.status === 'completed' || updates.status === 'failed') && !updates.completedAt) {
      sets.push('completed_at = ?');
      args.push(new Date().toISOString());
    }
  }
  if (updates.startedAt !== undefined) { sets.push('started_at = ?'); args.push(updates.startedAt); }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); args.push(updates.completedAt); }
  if (updates.resultSummary !== undefined) { sets.push('result_summary = ?'); args.push(updates.resultSummary); }
  if (updates.title !== undefined) { sets.push('title = ?'); args.push(updates.title); }
  if (updates.description !== undefined) { sets.push('description = ?'); args.push(updates.description); }

  if (sets.length === 0) return null;

  args.push(runId, nodeKey);
  await db.execute({
    sql: `UPDATE aris_plan_nodes SET ${sets.join(', ')} WHERE run_id = ? AND node_key = ?`,
    args,
  });

  // Return updated node
  const result = await db.execute({
    sql: 'SELECT * FROM aris_plan_nodes WHERE run_id = ? AND node_key = ? LIMIT 1',
    args: [runId, nodeKey],
  });
  return normalizePlanNode(result.rows?.[0]);
}

// ─── Build tree structure for frontend ──────────────────────────────────────

function buildPlanTree(nodes) {
  const nodeMap = new Map();
  for (const node of nodes) {
    nodeMap.set(node.nodeKey, { ...node, children: [] });
  }

  const roots = [];
  for (const node of nodeMap.values()) {
    if (node.parentKey && nodeMap.has(node.parentKey)) {
      nodeMap.get(node.parentKey).children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Compute aggregate status for parent nodes
  function computeStatus(node) {
    if (node.children.length === 0) return node;

    for (const child of node.children) {
      computeStatus(child);
    }

    const childStatuses = node.children.map(c => c.status);
    if (childStatuses.every(s => s === 'completed')) {
      node.status = 'completed';
    } else if (childStatuses.some(s => s === 'running')) {
      node.status = 'running';
    } else if (childStatuses.some(s => s === 'failed')) {
      node.status = 'failed';
    } else if (childStatuses.some(s => s === 'completed')) {
      node.status = 'running'; // partially done
    }

    return node;
  }

  for (const root of roots) {
    computeStatus(root);
  }

  // Compute progress stats
  const allLeaves = nodes.filter(n => !nodes.some(other => other.parentKey === n.nodeKey));
  const total = allLeaves.length;
  const completed = allLeaves.filter(n => n.status === 'completed').length;
  const running = allLeaves.filter(n => n.status === 'running').length;
  const failed = allLeaves.filter(n => n.status === 'failed').length;

  return {
    roots,
    stats: { total, completed, running, failed, pending: total - completed - running - failed },
  };
}

module.exports = {
  parsePlanMarkdown,
  savePlanNodes,
  getPlanNodes,
  updatePlanNode,
  buildPlanTree,
  normalizePlanNode,
};
