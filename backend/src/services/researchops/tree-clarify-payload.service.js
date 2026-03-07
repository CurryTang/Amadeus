'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeClarifyResult(result = null) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return {
    done: source.done === true,
    question: source.done === true ? null : (cleanString(source.question) || null),
    options: Array.isArray(source.options) ? source.options.map((item) => String(item)) : [],
  };
}

function buildTodoClarifyPayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    projectId: safeProjectId || null,
    ...normalizeClarifyResult(result),
    actions: safeProjectId ? {
      clarify: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/tree/nodes/from-todo/clarify`,
      },
    } : {},
  };
}

function buildTreeRunClarifyPayload({
  projectId = '',
  nodeId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  return {
    projectId: safeProjectId || null,
    nodeId: safeNodeId || null,
    ...normalizeClarifyResult(result),
    actions: (safeProjectId && safeNodeId) ? {
      clarify: {
        method: 'POST',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/tree/nodes/${encodeURIComponent(safeNodeId)}/run-clarify`,
      },
    } : {},
  };
}

module.exports = {
  buildTodoClarifyPayload,
  buildTreeRunClarifyPayload,
};
