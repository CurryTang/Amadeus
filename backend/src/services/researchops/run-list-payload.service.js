'use strict';

const { buildAttemptViewFromRun } = require('./attempt-view.service');
const { buildRunExecutionView } = require('./execution-view.service');
const { buildRunFollowUpView } = require('./follow-up-view.service');
const { buildRunOutputContractView } = require('./output-contract-view.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function deriveResultSnippet(run = {}) {
  const snippet = cleanString(run?.metadata?.resultSnippet);
  if (snippet) return snippet.slice(0, 120);
  if (run.lastMessage && typeof run.lastMessage === 'string') {
    return run.lastMessage.slice(0, 120);
  }
  if (run.status === 'SUCCEEDED') return 'Completed successfully';
  if (run.status === 'FAILED') return 'Run failed';
  if (run.status === 'CANCELLED') return 'Cancelled';
  return null;
}

function buildRunListItem(run = {}) {
  return {
    ...run,
    attempt: buildAttemptViewFromRun(run),
    execution: buildRunExecutionView(run),
    followUp: buildRunFollowUpView(run),
    contract: buildRunOutputContractView(run),
    resultSnippet: deriveResultSnippet(run),
  };
}

function buildRunListPayload({ page = {}, limit = 20, cursor = '' } = {}) {
  return {
    items: (Array.isArray(page?.items) ? page.items : []).map((run) => buildRunListItem(run)),
    limit,
    cursor: cursor || null,
    hasMore: Boolean(page?.hasMore),
    nextCursor: cleanString(page?.nextCursor) || null,
  };
}

module.exports = {
  buildRunListItem,
  buildRunListPayload,
  deriveResultSnippet,
};
