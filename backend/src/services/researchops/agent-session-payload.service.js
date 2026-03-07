'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentSession(session = null) {
  if (!session || typeof session !== 'object') return null;
  return {
    ...session,
    status: cleanString(session.status).toUpperCase() || 'UNKNOWN',
    lastRunStatus: cleanString(session.lastRunStatus).toUpperCase() || '',
  };
}

function buildAgentSessionListPayload({ sessions = [] } = {}) {
  return {
    sessions: (Array.isArray(sessions) ? sessions : [])
      .map((session) => normalizeAgentSession(session))
      .filter(Boolean),
  };
}

function buildAgentSessionPayload({ session = null } = {}) {
  return {
    session: normalizeAgentSession(session),
  };
}

function buildAgentSessionDetailPayload({ session = null, activeRun = null } = {}) {
  return {
    session: normalizeAgentSession(session),
    activeRun: activeRun && typeof activeRun === 'object' ? activeRun : null,
    activeAttempt: activeRun && typeof activeRun === 'object'
      ? buildAttemptViewFromRun(activeRun)
      : null,
  };
}

module.exports = {
  buildAgentSessionDetailPayload,
  buildAgentSessionListPayload,
  buildAgentSessionPayload,
  normalizeAgentSession,
};
