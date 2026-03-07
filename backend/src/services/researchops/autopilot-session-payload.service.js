'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSession(session = null) {
  const source = session && typeof session === 'object' ? session : {};
  return {
    ...source,
    id: cleanString(source.id) || null,
    projectId: cleanString(source.projectId) || null,
    status: cleanString(source.status).toUpperCase() || 'UNKNOWN',
    currentPhase: cleanString(source.currentPhase).toUpperCase() || null,
    currentTask: cleanString(source.currentTask) || null,
    currentRunId: cleanString(source.currentRunId) || null,
  };
}

function buildSessionActions(session = {}) {
  const sessionId = cleanString(session.id);
  const currentRunId = cleanString(session.currentRunId);
  if (!sessionId) return {};
  return {
    detail: {
      method: 'GET',
      path: `/researchops/autopilot/${sessionId}`,
    },
    stop: {
      method: 'POST',
      path: `/researchops/autopilot/${sessionId}/stop`,
    },
    ...(currentRunId ? {
      currentRun: {
        method: 'GET',
        path: `/researchops/runs/${currentRunId}`,
      },
    } : {}),
  };
}

function buildAutopilotSessionPayload({ session = null } = {}) {
  const normalized = normalizeSession(session);
  return {
    session: normalized,
    actions: buildSessionActions(normalized),
  };
}

function buildAutopilotSessionListPayload({
  projectId = '',
  sessions = [],
} = {}) {
  return {
    projectId: cleanString(projectId) || null,
    sessions: (Array.isArray(sessions) ? sessions : []).map((item) => normalizeSession(item)),
  };
}

module.exports = {
  buildAutopilotSessionPayload,
  buildAutopilotSessionListPayload,
};
