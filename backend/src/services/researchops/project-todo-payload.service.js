'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildTodoActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encoded = encodeURIComponent(safeProjectId);
  return {
    nextActions: {
      method: 'GET',
      path: `/researchops/projects/${encoded}/todos/next-actions`,
    },
    clearTodos: {
      method: 'POST',
      path: `/researchops/projects/${encoded}/todos/clear`,
    },
  };
}

function buildProjectTodoNextActionsPayload({
  projectId = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = asObject(result);
  return {
    projectId: safeProjectId || null,
    generatedAt: cleanString(source.generatedAt) || null,
    context: asObject(source.context),
    actionable: Array.isArray(source.actionable) ? source.actionable : [],
    blocked: Array.isArray(source.blocked) ? source.blocked : [],
    actions: buildTodoActions(safeProjectId),
  };
}

function buildProjectTodoClearPayload({
  projectId = '',
  cleared = 0,
  totalTodos = 0,
  status = '',
  refreshedAt = '',
} = {}) {
  const safeProjectId = cleanString(projectId);
  return {
    projectId: safeProjectId || null,
    cleared: Number.isFinite(Number(cleared)) ? Number(cleared) : 0,
    totalTodos: Number.isFinite(Number(totalTodos)) ? Number(totalTodos) : 0,
    status: cleanString(status) || null,
    refreshedAt: cleanString(refreshedAt) || null,
    actions: buildTodoActions(safeProjectId),
  };
}

module.exports = {
  buildProjectTodoNextActionsPayload,
  buildProjectTodoClearPayload,
};
