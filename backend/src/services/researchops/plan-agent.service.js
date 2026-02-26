const crypto = require('crypto');
const workflowSchemaService = require('./workflow-schema.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInstructionType(value = '') {
  const normalized = cleanString(value).toLowerCase();
  if (!normalized) return '';
  if (['simple', 'composite', 'exploratory', 'nested'].includes(normalized)) return normalized;
  return '';
}

function inferInstructionType(instruction = '') {
  const text = cleanString(instruction).toLowerCase();
  if (!text) return 'simple';
  const nestedHints = ['for each', 'each dataset', 'per dataset', '分别', '每个', 'for every'];
  if (nestedHints.some((hint) => text.includes(hint))) return 'nested';
  const exploratoryHints = ['research', 'survey', '调研', 'compare', '对比', 'benchmark'];
  if (exploratoryHints.some((hint) => text.includes(hint))) return 'exploratory';
  const compositeHints = [' and ', '然后', '再', 'then', 'after that'];
  if (compositeHints.some((hint) => text.includes(hint))) return 'composite';
  return 'simple';
}

function parseItemsForNestedPlan(instruction = '') {
  const raw = cleanString(instruction);
  if (!raw) return [];
  const fragments = raw
    .split(/,|，|;|；|\n|\|/)
    .map((item) => cleanString(item))
    .filter(Boolean);
  const items = fragments
    .map((item) => {
      const match = item.match(/(dataset[_\-\s]?\w+|d\d+|[a-z0-9_\-]{2,})/i);
      return cleanString(match ? match[1] : item);
    })
    .filter(Boolean);
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.slice(0, 8);
}

function makeNodeId(index) {
  return `n_${String(index + 1).padStart(3, '0')}`;
}

function baseNode({
  index,
  type,
  label,
  backend = {},
  inputs = [],
  outputs = [],
  resourceRequest = {},
  placement = {},
  retryPolicy = {},
}) {
  return {
    id: makeNodeId(index),
    type,
    label,
    backend,
    inputs,
    outputs,
    resource_request: {
      gpu: Number(resourceRequest.gpu) || 0,
      gpu_memory_gb: Number(resourceRequest.gpu_memory_gb) || 0,
      cpu_memory_gb: Number(resourceRequest.cpu_memory_gb) || 8,
      timeout_minutes: Number(resourceRequest.timeout_minutes) || 30,
    },
    placement: {
      preferred_server: cleanString(placement.preferred_server) || null,
      require_server: cleanString(placement.require_server) || null,
      affinity: Array.isArray(placement.affinity) ? placement.affinity : [],
    },
    retry_policy: {
      max_retries: Number.isFinite(Number(retryPolicy.max_retries)) ? Math.max(0, Math.floor(Number(retryPolicy.max_retries))) : 1,
      on_failure: ['pause', 'skip', 'abort'].includes(cleanString(retryPolicy.on_failure)) ? cleanString(retryPolicy.on_failure) : 'abort',
    },
    sub_plan: null,
  };
}

function buildSimplePlan(goal = '') {
  const nodes = [
    baseNode({
      index: 0,
      type: 'agent',
      label: 'Execute task and summarize outcome',
      backend: { agent: 'codex' },
      outputs: [
        { name: 'summary.md', type: 'output' },
      ],
      resourceRequest: { gpu: 0, cpu_memory_gb: 8, timeout_minutes: 20 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
  ];
  const edges = [];
  return {
    goal: goal || 'Execute requested task',
    nodes,
    edges,
    resource_estimate: {
      gpu: 0,
      cpu_memory_gb: 8,
      duration_minutes: 20,
    },
    risk_notes: [],
  };
}

function buildCompositePlan(goal = '') {
  const nodes = [
    baseNode({
      index: 0,
      type: 'agent',
      label: 'Plan and collect prerequisites',
      backend: { agent: 'claude' },
      outputs: [{ name: 'plan.json', type: 'output' }],
      resourceRequest: { gpu: 0, cpu_memory_gb: 8, timeout_minutes: 20 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
    baseNode({
      index: 1,
      type: 'bash',
      label: 'Run implementation command',
      backend: { command: 'bash run.sh' },
      inputs: [{ node_id: makeNodeId(0), artifact: 'plan.json' }],
      outputs: [{ name: 'results.json', type: 'deliverable' }],
      resourceRequest: { gpu: 1, gpu_memory_gb: 12, cpu_memory_gb: 16, timeout_minutes: 45 },
      retryPolicy: { max_retries: 2, on_failure: 'pause' },
    }),
    baseNode({
      index: 2,
      type: 'agent',
      label: 'Analyze outputs and write report',
      backend: { agent: 'gemini' },
      inputs: [{ node_id: makeNodeId(1), artifact: 'results.json' }],
      outputs: [{ name: 'report.md', type: 'output' }],
      resourceRequest: { gpu: 0, cpu_memory_gb: 8, timeout_minutes: 20 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
  ];
  const edges = [
    { from: makeNodeId(0), to: makeNodeId(1) },
    { from: makeNodeId(1), to: makeNodeId(2) },
  ];
  return {
    goal: goal || 'Execute composite workflow',
    nodes,
    edges,
    resource_estimate: {
      gpu: 1,
      cpu_memory_gb: 16,
      duration_minutes: 85,
    },
    risk_notes: ['Long-running bash stage may timeout or exceed memory budget.'],
  };
}

function buildExploratoryPlan(goal = '') {
  const nodes = [
    baseNode({
      index: 0,
      type: 'agent',
      label: 'Scan knowledge base and collect hypotheses',
      backend: { agent: 'claude' },
      outputs: [{ name: 'hypotheses.md', type: 'output' }],
      resourceRequest: { gpu: 0, cpu_memory_gb: 8, timeout_minutes: 15 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
    baseNode({
      index: 1,
      type: 'bash',
      label: 'Run benchmark branch A',
      backend: { command: 'python eval.py --variant a' },
      inputs: [{ node_id: makeNodeId(0), artifact: 'hypotheses.md' }],
      outputs: [{ name: 'result_a.json', type: 'deliverable' }],
      resourceRequest: { gpu: 1, gpu_memory_gb: 16, cpu_memory_gb: 16, timeout_minutes: 35 },
      retryPolicy: { max_retries: 2, on_failure: 'skip' },
    }),
    baseNode({
      index: 2,
      type: 'bash',
      label: 'Run benchmark branch B',
      backend: { command: 'python eval.py --variant b' },
      inputs: [{ node_id: makeNodeId(0), artifact: 'hypotheses.md' }],
      outputs: [{ name: 'result_b.json', type: 'deliverable' }],
      resourceRequest: { gpu: 1, gpu_memory_gb: 16, cpu_memory_gb: 16, timeout_minutes: 35 },
      retryPolicy: { max_retries: 2, on_failure: 'skip' },
    }),
    baseNode({
      index: 3,
      type: 'agent',
      label: 'Aggregate results and propose next steps',
      backend: { agent: 'codex' },
      inputs: [
        { node_id: makeNodeId(1), artifact: 'result_a.json' },
        { node_id: makeNodeId(2), artifact: 'result_b.json' },
      ],
      outputs: [{ name: 'comparison_report.md', type: 'output' }],
      resourceRequest: { gpu: 0, cpu_memory_gb: 10, timeout_minutes: 25 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
  ];
  const edges = [
    { from: makeNodeId(0), to: makeNodeId(1) },
    { from: makeNodeId(0), to: makeNodeId(2) },
    { from: makeNodeId(1), to: makeNodeId(3) },
    { from: makeNodeId(2), to: makeNodeId(3) },
  ];
  return {
    goal: goal || 'Run exploratory workflow',
    nodes,
    edges,
    resource_estimate: {
      gpu: 2,
      cpu_memory_gb: 32,
      duration_minutes: 75,
    },
    risk_notes: ['Parallel branches can saturate GPU slots.', 'Model comparison may need additional reruns for statistical confidence.'],
  };
}

function buildNestedPlan(goal = '', instruction = '') {
  const items = parseItemsForNestedPlan(instruction);
  const selectedItems = items.length > 0 ? items : ['dataset_1', 'dataset_2', 'dataset_3'];
  const nodes = [
    baseNode({
      index: 0,
      type: 'agent',
      label: 'Prepare shared config for per-item execution',
      backend: { agent: 'claude' },
      outputs: [{ name: 'shared_config.json', type: 'output' }],
      resourceRequest: { gpu: 0, cpu_memory_gb: 8, timeout_minutes: 20 },
      retryPolicy: { max_retries: 1, on_failure: 'abort' },
    }),
  ];
  const edges = [];
  selectedItems.forEach((item, i) => {
    const idx = i + 1;
    nodes.push(baseNode({
      index: idx,
      type: 'bash',
      label: `Run benchmark for ${item}`,
      backend: { command: `python eval.py --data ${item}` },
      inputs: [{ node_id: makeNodeId(0), artifact: 'shared_config.json' }],
      outputs: [{ name: `result_${item}.json`, type: 'deliverable' }],
      resourceRequest: { gpu: 1, gpu_memory_gb: 18, cpu_memory_gb: 20, timeout_minutes: 40 },
      retryPolicy: { max_retries: 2, on_failure: 'skip' },
    }));
    edges.push({ from: makeNodeId(0), to: makeNodeId(idx) });
  });
  const aggregateIndex = nodes.length;
  nodes.push(baseNode({
    index: aggregateIndex,
    type: 'agent',
    label: 'Aggregate nested branch results',
    backend: { agent: 'codex' },
    inputs: selectedItems.map((item, i) => ({
      node_id: makeNodeId(i + 1),
      artifact: `result_${item}.json`,
    })),
    outputs: [{ name: 'nested_summary.md', type: 'output' }],
    resourceRequest: { gpu: 0, cpu_memory_gb: 10, timeout_minutes: 25 },
    retryPolicy: { max_retries: 1, on_failure: 'abort' },
  }));
  selectedItems.forEach((_, i) => {
    edges.push({ from: makeNodeId(i + 1), to: makeNodeId(aggregateIndex) });
  });

  return {
    goal: goal || 'Run nested workflow across items',
    nodes,
    edges,
    resource_estimate: {
      gpu: Math.min(selectedItems.length, 4),
      cpu_memory_gb: 32,
      duration_minutes: 20 + (selectedItems.length * 20),
    },
    risk_notes: selectedItems.length >= 4
      ? ['High parallel fan-out may exceed available GPUs; scheduler should queue overflow branches.']
      : [],
  };
}

function toWorkflow(plan = {}) {
  const nodes = Array.isArray(plan.nodes) ? plan.nodes : [];
  const edges = Array.isArray(plan.edges) ? plan.edges : [];
  const depsByNode = new Map();
  nodes.forEach((node) => depsByNode.set(node.id, []));
  edges.forEach((edge) => {
    const from = cleanString(edge.from);
    const to = cleanString(edge.to);
    if (!from || !to || !depsByNode.has(to)) return;
    depsByNode.get(to).push(from);
  });

  const workflow = nodes.map((node) => {
    const type = cleanString(node.type).toLowerCase();
    const moduleType = type === 'agent'
      ? 'agent.run'
      : type === 'script'
        ? 'bash.run'
        : 'bash.run';
    const backend = node.backend && typeof node.backend === 'object' ? node.backend : {};
    const command = cleanString(backend.command || backend.script);
    const prompt = cleanString(backend.prompt);
    const defaultPrompt = cleanString(node.label) || 'Execute task and summarize output';
    return {
      id: node.id,
      type: moduleType,
      dependsOn: depsByNode.get(node.id) || [],
      retryPolicy: {
        maxRetries: Number(node?.retry_policy?.max_retries) || 0,
        onFailure: cleanString(node?.retry_policy?.on_failure || 'abort'),
      },
      inputs: moduleType === 'agent.run'
        ? {
          prompt: prompt || `${defaultPrompt}.`,
          ...(cleanString(backend.agent) ? { provider: cleanString(backend.agent) } : {}),
        }
        : {
          cmd: command || 'echo "No command provided"',
        },
      resourceRequest: node.resource_request || {},
      placement: node.placement || {},
    };
  });

  return workflowSchemaService.normalizeAndValidateWorkflow(workflow, { allowEmpty: false });
}

function generatePlan({ instruction = '', instructionType = '' } = {}) {
  const goal = cleanString(instruction) || 'Execute requested objective';
  const finalInstructionType = normalizeInstructionType(instructionType) || inferInstructionType(goal);
  let plan;
  if (finalInstructionType === 'nested') {
    plan = buildNestedPlan(goal, instruction);
  } else if (finalInstructionType === 'exploratory') {
    plan = buildExploratoryPlan(goal);
  } else if (finalInstructionType === 'composite') {
    plan = buildCompositePlan(goal);
  } else {
    plan = buildSimplePlan(goal);
  }

  const workflow = toWorkflow(plan);
  return {
    plan_id: `plan_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    instruction_type: finalInstructionType,
    goal: plan.goal,
    nodes: plan.nodes,
    edges: plan.edges,
    resource_estimate: plan.resource_estimate,
    risk_notes: plan.risk_notes,
    workflow,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  generatePlan,
  inferInstructionType,
};
