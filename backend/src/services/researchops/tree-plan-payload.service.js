'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildPlanActions(projectId = '') {
  const safeProjectId = cleanString(projectId);
  if (!safeProjectId) return {};
  const encodedProjectId = encodeURIComponent(safeProjectId);
  return {
    read: {
      method: 'GET',
      path: `/researchops/projects/${encodedProjectId}/tree/plan`,
    },
    update: {
      method: 'PUT',
      path: `/researchops/projects/${encodedProjectId}/tree/plan`,
    },
    validate: {
      method: 'POST',
      path: `/researchops/projects/${encodedProjectId}/tree/plan/validate`,
    },
    patch: {
      method: 'POST',
      path: `/researchops/projects/${encodedProjectId}/tree/plan/patches`,
    },
    impactPreview: {
      method: 'POST',
      path: `/researchops/projects/${encodedProjectId}/tree/plan/impact-preview`,
    },
  };
}

function buildTreePlanPayload({
  projectId = '',
  plan = null,
  validation = null,
  paths = null,
  rootSummary = null,
  degraded = null,
  environmentDetected = null,
  refreshedAt = '',
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    plan,
    validation,
    paths,
    rootSummary,
    degraded,
    environmentDetected,
    refreshedAt: cleanString(refreshedAt) || new Date().toISOString(),
    actions: buildPlanActions(projectId),
  };
}

function buildTreePlanValidationPayload({
  projectId = '',
  plan = null,
  validation = null,
  valid = null,
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    plan,
    validation,
    valid: typeof valid === 'boolean' ? valid : Boolean(validation?.valid),
    actions: buildPlanActions(projectId),
  };
}

function buildTreePlanPatchPayload({
  projectId = '',
  plan = null,
  validation = null,
  impact = null,
  applied = [],
  updatedAt = '',
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    plan,
    validation,
    impact,
    applied: Array.isArray(applied) ? applied : [],
    updatedAt: cleanString(updatedAt) || new Date().toISOString(),
    actions: buildPlanActions(projectId),
  };
}

function buildTreePlanImpactPayload({
  projectId = '',
  validation = null,
  impact = null,
  applied = [],
  previewPlan = null,
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    validation,
    impact,
    applied: Array.isArray(applied) ? applied : [],
    previewPlan,
    actions: buildPlanActions(projectId),
  };
}

module.exports = {
  buildTreePlanImpactPayload,
  buildTreePlanPatchPayload,
  buildTreePlanPayload,
  buildTreePlanValidationPayload,
};
