'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function inferMode(pack = {}) {
  if (Array.isArray(pack?.selected_items) || pack?.run_intent) return 'routed';
  return 'legacy';
}

function uniqueStrings(values = [], { limit = 4 } = {}) {
  const seen = new Set();
  const out = [];
  values.forEach((value) => {
    const text = cleanString(value);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out.slice(0, limit);
}

function buildContextPackView({ pack = {}, mode = '' } = {}) {
  const effectiveMode = cleanString(mode) || inferMode(pack);
  const roleBudgetTokens = {
    runner: cleanNumber(pack?.budget_report?.role_budget_tokens?.runner),
    coder: cleanNumber(pack?.budget_report?.role_budget_tokens?.coder),
    analyst: cleanNumber(pack?.budget_report?.role_budget_tokens?.analyst),
    writer: cleanNumber(pack?.budget_report?.role_budget_tokens?.writer),
  };
  return {
    mode: effectiveMode,
    runId: cleanString(pack?.runId),
    nodeId: cleanString(pack?.run_intent?.goal?.nodeId),
    goalTitle: cleanString(pack?.run_intent?.goal?.title || pack?.run_intent?.goal?.summary),
    selectedItemCount: Array.isArray(pack?.selected_items) ? pack.selected_items.length : 0,
    groupCount: Array.isArray(pack?.groups) ? pack.groups.length : 0,
    documentCount: Array.isArray(pack?.documents) ? pack.documents.length : 0,
    assetCount: Array.isArray(pack?.assets) ? pack.assets.length : 0,
    resourcePathCount: Array.isArray(pack?.resourceHints?.paths) ? pack.resourceHints.paths.length : 0,
    topBuckets: uniqueStrings(
      Array.isArray(pack?.selected_items) ? pack.selected_items.map((item) => item?.bucket) : []
    ),
    roleBudgetTokens,
    rationale: cleanString(pack?.rationale),
  };
}

module.exports = {
  buildContextPackView,
};
