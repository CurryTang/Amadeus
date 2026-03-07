'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function encodePath(value = '') {
  return encodeURIComponent(cleanString(value));
}

function buildBridgeDaemonTaskRequest(taskType = '', payload = {}) {
  const normalizedTaskType = cleanString(taskType);
  const source = asObject(payload);
  if (normalizedTaskType === 'bridge.fetchNodeContext') {
    const projectId = encodePath(source.projectId);
    const nodeId = encodePath(source.nodeId);
    if (!projectId || !nodeId) return null;
    const query = {};
    if (source.includeContextPack === true) query.includeContextPack = true;
    if (source.includeReport === true) query.includeReport = true;
    return {
      method: 'GET',
      path: `/researchops/projects/${projectId}/tree/nodes/${nodeId}/bridge-context`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
    };
  }
  if (normalizedTaskType === 'bridge.fetchContextPack') {
    const runId = encodePath(source.runId);
    if (!runId) return null;
    return {
      method: 'GET',
      path: `/researchops/runs/${runId}/context-pack`,
    };
  }
  if (normalizedTaskType === 'bridge.submitNodeRun') {
    const projectId = encodePath(source.projectId);
    const nodeId = encodePath(source.nodeId);
    if (!projectId || !nodeId) return null;
    return {
      method: 'POST',
      path: `/researchops/projects/${projectId}/tree/nodes/${nodeId}/bridge-run`,
      body: {
        ...(source.force === true ? { force: true } : {}),
        ...(source.preflightOnly === true ? { preflightOnly: true } : {}),
        ...(Number.isFinite(source.searchTrialCount) ? { searchTrialCount: source.searchTrialCount } : {}),
        ...(Array.isArray(source.clarifyMessages) ? { clarifyMessages: source.clarifyMessages } : {}),
        ...(source.workspaceSnapshot && typeof source.workspaceSnapshot === 'object' ? { workspaceSnapshot: source.workspaceSnapshot } : {}),
        ...(source.localSnapshot && typeof source.localSnapshot === 'object' ? { localSnapshot: source.localSnapshot } : {}),
      },
    };
  }
  if (normalizedTaskType === 'bridge.fetchRunReport') {
    const runId = encodePath(source.runId);
    if (!runId) return null;
    return {
      method: 'GET',
      path: `/researchops/runs/${runId}/bridge-report`,
    };
  }
  if (normalizedTaskType === 'bridge.submitRunNote') {
    const runId = encodePath(source.runId);
    if (!runId) return null;
    return {
      method: 'POST',
      path: `/researchops/runs/${runId}/bridge-note`,
      body: {
        ...(cleanString(source.title) ? { title: cleanString(source.title) } : {}),
        ...(cleanString(source.content) ? { content: cleanString(source.content) } : {}),
        ...(cleanString(source.noteType) ? { noteType: cleanString(source.noteType) } : {}),
      },
    };
  }
  return null;
}

module.exports = {
  buildBridgeDaemonTaskRequest,
};
