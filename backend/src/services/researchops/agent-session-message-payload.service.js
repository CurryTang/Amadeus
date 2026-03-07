'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { normalizeAgentSession } = require('./agent-session-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAgentSessionMessage(message = null) {
  if (!message || typeof message !== 'object') return null;
  return {
    ...message,
    status: message.status == null ? null : (cleanString(message.status).toUpperCase() || null),
    attachments: Array.isArray(message.attachments) ? message.attachments : [],
    metadata: message.metadata && typeof message.metadata === 'object' ? message.metadata : {},
  };
}

function buildAgentSessionMessagesPayload({ items = [], total = 0 } = {}) {
  return {
    items: (Array.isArray(items) ? items : [])
      .map((item) => normalizeAgentSessionMessage(item))
      .filter(Boolean),
    total: Number.isFinite(Number(total)) ? Number(total) : 0,
  };
}

function buildAgentSessionMessageActionPayload({
  session = null,
  run = null,
  userMessage = null,
} = {}) {
  return {
    session: normalizeAgentSession(session),
    run: run && typeof run === 'object' ? run : null,
    attempt: run && typeof run === 'object' ? buildAttemptViewFromRun(run) : null,
    userMessage: normalizeAgentSessionMessage(userMessage),
  };
}

module.exports = {
  buildAgentSessionMessageActionPayload,
  buildAgentSessionMessagesPayload,
  normalizeAgentSessionMessage,
};
