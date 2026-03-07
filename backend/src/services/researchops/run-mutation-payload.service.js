'use strict';

const { buildRunEventListPayload } = require('./run-event-list-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildRunDeletePayload({
  runId = '',
  deleted = false,
} = {}) {
  const safeRunId = cleanString(runId);
  return {
    runId: safeRunId || null,
    deleted: deleted === true,
    actions: safeRunId ? {
      runDetail: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}`,
      },
      deleteRun: {
        method: 'DELETE',
        path: `/researchops/runs/${encodeURIComponent(safeRunId)}`,
      },
    } : {},
  };
}

function buildProjectRunClearPayload({
  projectId = '',
  status = '',
  result = null,
} = {}) {
  const safeProjectId = cleanString(projectId);
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return {
    projectId: safeProjectId || null,
    filters: {
      status: cleanString(status).toUpperCase() || null,
    },
    deletedCount: Number.isFinite(Number(source.deletedCount)) ? Number(source.deletedCount) : 0,
    actions: safeProjectId ? {
      clear: {
        method: 'DELETE',
        path: `/researchops/projects/${encodeURIComponent(safeProjectId)}/runs`,
      },
    } : {},
  };
}

function buildRunEventMutationPayload({
  runId = '',
  result = null,
} = {}) {
  const eventList = buildRunEventListPayload({ runId, result });
  return {
    runId: eventList.runId,
    count: eventList.items.length,
    items: eventList.items,
    nextAfterSequence: eventList.nextAfterSequence,
    actions: eventList.runId ? {
      events: {
        method: 'GET',
        path: `/researchops/runs/${encodeURIComponent(eventList.runId)}/events`,
      },
      publishEvents: {
        method: 'POST',
        path: `/researchops/runs/${encodeURIComponent(eventList.runId)}/events`,
      },
    } : {},
  };
}

module.exports = {
  buildRunDeletePayload,
  buildProjectRunClearPayload,
  buildRunEventMutationPayload,
};
