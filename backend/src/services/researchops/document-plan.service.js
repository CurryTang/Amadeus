'use strict';

const { normalizePlan } = require('./plan-patch.service');
const treeStateService = require('./tree-state.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeToken(value = '', fallback = 'document_plan') {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function extractDocumentPlanResult(text = '') {
  const raw = String(text || '');
  const blockMatch = raw.match(/DOCUMENT_PLAN_RESULT\s*([\s\S]*?)\s*END_DOCUMENT_PLAN_RESULT/i);
  if (blockMatch?.[1]) {
    const candidate = String(blockMatch[1]).trim();
    const parsed = JSON.parse(candidate);
    return normalizeDocumentPlanResult(parsed);
  }
  const parsed = JSON.parse(raw);
  return normalizeDocumentPlanResult(parsed);
}

function normalizeDocumentPlanStep(step = {}, index = 0) {
  const source = asObject(step);
  const id = cleanString(source.id || source.stepId || source.step_id) || `step_${index + 1}`;
  const title = cleanString(source.title) || `Step ${index + 1}`;
  const todoId = cleanString(source.todoId || source.todo_id) || `todo:${id}`;
  const allowedMarkers = asArray(source.allowedMarkers || source.allowed_markers)
    .map((item) => cleanString(item))
    .filter(Boolean);
  return {
    id,
    title,
    kind: cleanString(source.kind) || 'experiment',
    objective: cleanString(source.objective || source.description) || title,
    dependsOn: asArray(source.dependsOn || source.depends_on).map((item) => cleanString(item)).filter(Boolean),
    todoId,
    allowedMarkers: allowedMarkers.length > 0 ? allowedMarkers : [`step:${id}`, todoId],
  };
}

function normalizeDocumentPlanResult(input = {}) {
  const source = asObject(input);
  const steps = asArray(source.steps).map((step, index) => normalizeDocumentPlanStep(step, index));
  if (steps.length === 0) {
    throw new Error('Document plan must contain at least one step');
  }
  const planId = sanitizeToken(cleanString(source.planId || source.plan_id) || `document_plan_${Date.now()}`);
  const title = cleanString(source.title) || 'Generated Document Plan';
  const documentPath = cleanString(source.documentPath || source.document_path) || 'docs/exp.md';
  return {
    planId,
    title,
    documentPath,
    summary: cleanString(source.summary),
    steps,
  };
}

function buildDocumentPlanRootNode(documentPlan = {}) {
  return {
    id: documentPlan.planId,
    title: documentPlan.title || 'Generated Document Plan',
    kind: 'milestone',
    assumption: [`Generated document path: ${documentPlan.documentPath}`],
    target: ['Review and execute generated document plan steps'],
    commands: [],
    checks: [],
    tags: ['document-plan', 'generated'],
    ui: {
      documentPlan: true,
      documentPath: documentPlan.documentPath,
      planId: documentPlan.planId,
    },
  };
}

function buildDocumentPlanStepNode(documentPlan = {}, step = {}) {
  const nodeId = `${documentPlan.planId}__${sanitizeToken(step.id, 'step')}`;
  return {
    id: nodeId,
    parent: documentPlan.planId,
    title: step.title,
    kind: step.kind || 'experiment',
    assumption: [],
    target: [step.objective || step.title],
    commands: [],
    checks: [],
    evidenceDeps: step.dependsOn.map((depId) => `${documentPlan.planId}__${sanitizeToken(depId, 'step')}`),
    tags: ['document-plan', 'generated', step.kind || 'experiment'],
    ui: {
      documentPlan: true,
      documentPlanStep: {
        planId: documentPlan.planId,
        stepId: step.id,
        title: step.title,
        todoId: step.todoId,
        documentPath: documentPlan.documentPath,
        allowedMarkers: step.allowedMarkers,
      },
    },
  };
}

function stripExistingDocumentPlanNodes(nodes = []) {
  return asArray(nodes).filter((node) => node?.ui?.documentPlan !== true && !asArray(node?.tags).includes('document-plan'));
}

function materializeDocumentPlanTree({
  projectName = 'AutoResearch',
  currentPlan = {},
  documentPlan,
} = {}) {
  const normalizedDocumentPlan = normalizeDocumentPlanResult(documentPlan);
  const baseNodes = stripExistingDocumentPlanNodes(asArray(currentPlan?.nodes));
  const rootNode = buildDocumentPlanRootNode(normalizedDocumentPlan);
  const stepNodes = normalizedDocumentPlan.steps.map((step) => buildDocumentPlanStepNode(normalizedDocumentPlan, step));
  const plan = normalizePlan({
    version: Number(currentPlan?.version) || 1,
    project: cleanString(currentPlan?.project) || cleanString(projectName) || 'AutoResearch',
    vars: currentPlan?.vars && typeof currentPlan.vars === 'object' ? currentPlan.vars : {},
    nodes: [...baseNodes, rootNode, ...stepNodes],
  });
  let state = treeStateService.normalizeState({});
  for (const node of [rootNode, ...stepNodes]) {
    state = treeStateService.setNodeState(state, node.id, {
      status: 'IDLE',
      documentPlan: true,
    });
  }
  return {
    documentPlan: normalizedDocumentPlan,
    plan,
    state,
    rootNodeId: rootNode.id,
  };
}

module.exports = {
  extractDocumentPlanResult,
  normalizeDocumentPlanResult,
  materializeDocumentPlanTree,
};
