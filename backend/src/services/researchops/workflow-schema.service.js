function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDependsOn(value) {
  const out = [];
  const seen = new Set();
  for (const dep of asArray(value)) {
    const id = cleanString(dep);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeRetryPolicy(value) {
  const policy = asObject(value);
  const retriesRaw = Number(policy.maxRetries);
  const maxRetries = Number.isFinite(retriesRaw)
    ? Math.min(Math.max(Math.floor(retriesRaw), 0), 20)
    : 0;
  const onFailure = cleanString(policy.onFailure).toLowerCase();
  return {
    maxRetries,
    onFailure: ['pause', 'skip', 'abort'].includes(onFailure) ? onFailure : 'abort',
  };
}

function normalizeWorkflowStep(step = {}, index = 0) {
  const src = asObject(step);
  const id = cleanString(src.id) || `step_${index + 1}`;
  const type = cleanString(src.type || src.moduleType).toLowerCase();
  const out = {
    ...src,
    id,
    type,
    moduleType: type,
    inputs: asObject(src.inputs),
    dependsOn: normalizeDependsOn(src.dependsOn),
    retryPolicy: normalizeRetryPolicy(src.retryPolicy),
    order: Number.isFinite(Number(src.order)) ? Number(src.order) : index,
  };
  return out;
}

function validateWorkflowGraph(steps = []) {
  const byId = new Map();
  for (const step of steps) {
    if (!step.id) throw new Error('Workflow step id is required');
    if (!step.type) throw new Error(`Workflow step ${step.id} is missing type`);
    if (byId.has(step.id)) throw new Error(`Duplicate workflow step id: ${step.id}`);
    byId.set(step.id, step);
  }

  for (const step of steps) {
    for (const depId of step.dependsOn) {
      if (depId === step.id) throw new Error(`Workflow step ${step.id} cannot depend on itself`);
      if (!byId.has(depId)) {
        throw new Error(`Workflow step ${step.id} depends on unknown step: ${depId}`);
      }
    }
  }

  const indegree = new Map();
  const outgoing = new Map();
  for (const step of steps) {
    indegree.set(step.id, step.dependsOn.length);
    outgoing.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      outgoing.get(dep).push(step.id);
    }
  }

  const queue = steps
    .filter((step) => indegree.get(step.id) === 0)
    .sort((a, b) => a.order - b.order)
    .map((step) => step.id);
  let visited = 0;
  while (queue.length) {
    const currentId = queue.shift();
    visited += 1;
    for (const nextId of outgoing.get(currentId)) {
      const next = indegree.get(nextId) - 1;
      indegree.set(nextId, next);
      if (next === 0) queue.push(nextId);
    }
  }
  if (visited !== steps.length) {
    throw new Error('Workflow graph contains a cycle');
  }
}

function normalizeAndValidateWorkflow(workflow = [], { allowEmpty = true } = {}) {
  const normalized = asArray(workflow).map((step, index) => normalizeWorkflowStep(step, index));
  if (!allowEmpty && normalized.length === 0) {
    throw new Error('Workflow must contain at least one step');
  }
  if (normalized.length > 0) validateWorkflowGraph(normalized);
  return normalized;
}

function topologicallySortWorkflow(steps = []) {
  const byId = new Map();
  const indegree = new Map();
  const outgoing = new Map();
  for (const step of steps) {
    byId.set(step.id, step);
    indegree.set(step.id, step.dependsOn.length);
    outgoing.set(step.id, []);
  }
  for (const step of steps) {
    for (const dep of step.dependsOn) {
      if (outgoing.has(dep)) outgoing.get(dep).push(step.id);
    }
  }

  const queue = steps
    .filter((step) => indegree.get(step.id) === 0)
    .sort((a, b) => a.order - b.order)
    .map((step) => step.id);
  const sorted = [];
  while (queue.length) {
    const currentId = queue.shift();
    const currentStep = byId.get(currentId);
    if (currentStep) sorted.push(currentStep);
    for (const nextId of outgoing.get(currentId) || []) {
      const next = indegree.get(nextId) - 1;
      indegree.set(nextId, next);
      if (next === 0) {
        queue.push(nextId);
        queue.sort((a, b) => {
          const left = byId.get(a);
          const right = byId.get(b);
          return (left?.order || 0) - (right?.order || 0);
        });
      }
    }
  }
  return sorted;
}

module.exports = {
  normalizeAndValidateWorkflow,
  topologicallySortWorkflow,
};
