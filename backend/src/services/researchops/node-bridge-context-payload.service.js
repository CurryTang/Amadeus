'use strict';

const {
  buildBridgeDaemonTaskActions,
  buildBridgeDaemonTaskSubmitHints,
} = require('./bridge-daemon-task-action.service');
const { buildBridgeTransportEnum } = require('./bridge-transport.service');
const { buildBridgeRuntimeView } = require('./bridge-runtime-view.service');
const { buildRunPayload } = require('./run-payload.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildBridgeActions({ projectId = '', nodeId = '', runId = '' } = {}) {
  const safeProjectId = cleanString(projectId);
  const safeNodeId = cleanString(nodeId);
  const safeRunId = cleanString(runId);
  return {
    ...(safeProjectId && safeNodeId ? {
      bridgeContext: {
        method: 'GET',
        path: `/researchops/projects/${safeProjectId}/tree/nodes/${safeNodeId}/bridge-context`,
      },
      bridgeRun: {
        method: 'POST',
        path: `/researchops/projects/${safeProjectId}/tree/nodes/${safeNodeId}/bridge-run`,
      },
    } : {}),
    ...(safeRunId ? {
      contextPack: {
        method: 'GET',
        path: `/researchops/runs/${safeRunId}/context-pack`,
      },
      report: {
        method: 'GET',
        path: `/researchops/runs/${safeRunId}/report`,
      },
      artifacts: {
        method: 'GET',
        path: `/researchops/runs/${safeRunId}/artifacts`,
      },
      bridgeReport: {
        method: 'GET',
        path: `/researchops/runs/${safeRunId}/bridge-report`,
      },
      bridgeNote: {
        method: 'POST',
        path: `/researchops/runs/${safeRunId}/bridge-note`,
      },
    } : {}),
  };
}

function buildBridgeSubmitHints(bridgeRuntime = null) {
  const transportEnum = buildBridgeTransportEnum({ bridgeRuntime });
  return {
    bridgeContext: {
      query: {
        includeContextPack: 'boolean',
        includeReport: 'boolean',
        transport: transportEnum,
      },
    },
    bridgeRun: {
      body: {
        transport: transportEnum,
        force: 'boolean',
        preflightOnly: 'boolean',
        searchTrialCount: 'integer(1..64)',
        clarifyMessages: 'array',
        workspaceSnapshot: {
          path: 'string|null',
          sourceServerId: 'string|null',
          runSpecArtifactId: 'string|null',
        },
        localSnapshot: {
          kind: 'string',
          note: 'string',
        },
      },
    },
    bridgeNote: {
      body: {
        title: 'string',
        content: 'string',
        noteType: 'string',
      },
    },
  };
}

function buildNodeBridgeContextPayload({
  projectId = '',
  node = null,
  nodeState = null,
  blocking = null,
  run = null,
  contextPack = null,
  bridgeReport = null,
  bridgeRuntime = null,
} = {}) {
  const normalizedNode = asObject(node);
  const normalizedState = asObject(nodeState);
  const normalizedBlocking = asObject(blocking);
  const normalizedContextPack = asObject(contextPack);
  const normalizedBridgeReport = asObject(bridgeReport);
  const normalizedBridgeRuntime = buildBridgeRuntimeView(bridgeRuntime);
  const bridgeSnapshots = asObject(normalizedBridgeReport.snapshots);
  const workspaceSnapshot = asObject(bridgeSnapshots.workspace);
  const envSnapshot = asObject(bridgeSnapshots.env);
  const localSnapshot = asObject(workspaceSnapshot.localSnapshot);
  const lastRun = run ? buildRunPayload({ run }) : null;
  const resolvedProjectId = cleanString(projectId) || cleanString(lastRun?.run?.projectId);
  const resolvedNodeId = cleanString(normalizedNode.id);
  const resolvedRunId = cleanString(lastRun?.run?.id || normalizedBridgeReport?.runId);
  const taskActions = buildBridgeDaemonTaskActions({
    serverId: normalizedBridgeRuntime?.serverId,
    projectId: resolvedProjectId,
    nodeId: resolvedNodeId,
    runId: resolvedRunId,
    sourceServerId: cleanString(lastRun?.execution?.serverId),
  });
  return {
    bridgeVersion: 'v0',
    projectId: resolvedProjectId || null,
    nodeId: resolvedNodeId || null,
    node: node || null,
    nodeState: nodeState || null,
    blocking: {
      blocked: Boolean(normalizedBlocking.blocked),
      blockedBy: Array.isArray(normalizedBlocking.blockedBy) ? normalizedBlocking.blockedBy : [],
    },
    lastRun,
    contextPack: normalizedContextPack && Object.keys(normalizedContextPack).length > 0 ? normalizedContextPack : null,
    bridgeReport: normalizedBridgeReport && Object.keys(normalizedBridgeReport).length > 0 ? normalizedBridgeReport : null,
    bridgeRuntime: normalizedBridgeRuntime && Object.keys(normalizedBridgeRuntime).length > 0 ? normalizedBridgeRuntime : null,
    actions: buildBridgeActions({
      projectId: resolvedProjectId,
      nodeId: resolvedNodeId,
      runId: resolvedRunId,
    }),
    taskActions,
    taskSubmitHints: buildBridgeDaemonTaskSubmitHints(),
    submitHints: buildBridgeSubmitHints(bridgeRuntime),
    capabilities: {
      hasLastRun: Boolean(lastRun?.run?.id),
      hasContextPack: Boolean(normalizedContextPack?.view || normalizedContextPack?.pack || normalizedContextPack?.mode),
      hasBridgeReport: Boolean(normalizedBridgeReport?.runId),
      hasWorkspaceSnapshot: Boolean(workspaceSnapshot.path || workspaceSnapshot.runSpecArtifactId || workspaceSnapshot.sourceServerId),
      hasLocalSnapshot: Boolean(localSnapshot.kind || localSnapshot.note),
      hasEnvSnapshot: Boolean(envSnapshot.backend || envSnapshot.runtimeClass || envSnapshot.resources),
      hasContractFailures: normalizedBridgeReport?.flags?.hasContractFailures === true,
      canUseLocalBridgeWorkflow: normalizedBridgeRuntime?.supportsLocalBridgeWorkflow === true,
      missingBridgeTaskTypes: Array.isArray(normalizedBridgeRuntime?.missingBridgeTaskTypes)
        ? normalizedBridgeRuntime.missingBridgeTaskTypes
        : [],
      canRun: true,
    },
  };
}

module.exports = {
  buildNodeBridgeContextPayload,
};
