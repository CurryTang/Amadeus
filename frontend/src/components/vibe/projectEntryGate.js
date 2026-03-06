function cleanString(value) {
  const next = String(value || '').trim();
  return next || '';
}

function normalizeStatus(value) {
  return cleanString(value).toUpperCase();
}

function findEnvironmentRoot(plan = {}) {
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  return nodes.find((node) => {
    const tags = Array.isArray(node?.tags) ? node.tags : [];
    return cleanString(node?.id) === 'project_environment'
      || tags.includes('environment_root');
  }) || null;
}

function createEmptyTreeState() {
  return {
    nodes: {},
    runs: {},
    queue: {
      paused: false,
      pausedReason: '',
      updatedAt: null,
      items: [],
    },
    search: {},
    updatedAt: null,
  };
}

export function applyOptimisticJumpstartTreeState({
  treeState = null,
  payload = null,
} = {}) {
  const fallbackPlan = Array.isArray(payload?.nodes) ? { nodes: payload.nodes } : payload?.plan;
  const environmentRoot = findEnvironmentRoot(fallbackPlan);
  const nodeId = cleanString(payload?.autoRun?.nodeId) || cleanString(environmentRoot?.id);
  if (!nodeId) return treeState && typeof treeState === 'object' ? treeState : createEmptyTreeState();

  const baseState = treeState && typeof treeState === 'object' ? treeState : createEmptyTreeState();
  const nodes = baseState?.nodes && typeof baseState.nodes === 'object' ? baseState.nodes : {};
  const nextStatus = normalizeStatus(payload?.autoRun?.status) || 'QUEUED';

  return {
    ...baseState,
    nodes: {
      ...nodes,
      [nodeId]: {
        ...(nodes[nodeId] && typeof nodes[nodeId] === 'object' ? nodes[nodeId] : {}),
        status: nextStatus,
        lastRunStatus: nextStatus,
        runSource: 'jumpstart',
        updatedAt: cleanString(payload?.updatedAt) || nodes[nodeId]?.updatedAt || null,
      },
    },
    updatedAt: cleanString(payload?.updatedAt) || baseState.updatedAt || null,
  };
}

export function shouldShowProjectEntryGate({
  project = null,
  plan = null,
  treeState = null,
  environmentDetected = null,
} = {}) {
  if (!project || cleanString(project?.projectMode) !== 'new_project') return false;
  // If the backend detected environment markers on the filesystem, skip the gate.
  if (environmentDetected === true) return false;
  const environmentRoot = findEnvironmentRoot(plan);
  if (!environmentRoot) return true;
  const rootStatus = normalizeStatus(treeState?.nodes?.[environmentRoot.id]?.status);
  if (rootStatus === 'PASSED' || rootStatus === 'SUCCEEDED') return false;
  if (rootStatus === 'QUEUED' || rootStatus === 'RUNNING' || rootStatus === 'PROVISIONING') return false;
  return true;
}
