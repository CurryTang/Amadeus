'use strict';

const DAEMON_TASK_CATALOG_VERSION = 'v0';

const BUILT_IN_DAEMON_TASK_TYPES = [
  'project.checkPath',
  'project.ensurePath',
  'project.ensureGit',
];

const OPTIONAL_BRIDGE_DAEMON_TASK_TYPES = [
  'bridge.fetchNodeContext',
  'bridge.fetchContextPack',
  'bridge.submitNodeRun',
  'bridge.fetchRunReport',
  'bridge.submitRunNote',
];

const TASK_DESCRIPTOR_MAP = {
  'project.checkPath': {
    taskType: 'project.checkPath',
    family: 'project',
    builtIn: true,
    handlerMode: 'builtin',
    summary: 'Check whether a project path exists and is a directory.',
    payloadShape: {
      projectPath: 'string',
    },
    resultShape: {
      exists: 'boolean',
      isDirectory: 'boolean',
      normalizedPath: 'string',
    },
  },
  'project.ensurePath': {
    taskType: 'project.ensurePath',
    family: 'project',
    builtIn: true,
    handlerMode: 'builtin',
    summary: 'Ensure the project directory exists on the client daemon host.',
    payloadShape: {
      projectPath: 'string',
    },
    resultShape: {
      normalizedPath: 'string',
    },
  },
  'project.ensureGit': {
    taskType: 'project.ensureGit',
    family: 'project',
    builtIn: true,
    handlerMode: 'builtin',
    summary: 'Ensure the project directory is a git repository.',
    payloadShape: {
      projectPath: 'string',
    },
    resultShape: {
      rootPath: 'string',
      isGitRepo: 'boolean',
      initialized: 'boolean',
    },
  },
  'bridge.fetchNodeContext': {
    taskType: 'bridge.fetchNodeContext',
    family: 'bridge',
    builtIn: false,
    handlerMode: 'custom',
    summary: 'Fetch node bridge context, optionally with context pack and bridge report.',
    payloadShape: {
      projectId: 'string',
      nodeId: 'string',
      includeContextPack: 'boolean?',
      includeReport: 'boolean?',
    },
    resultShape: {
      bridgeVersion: 'string',
      node: 'object',
      nodeState: 'object',
      blocking: 'object',
      lastRun: 'object?',
      contextPack: 'object?',
      bridgeReport: 'object?',
    },
  },
  'bridge.fetchContextPack': {
    taskType: 'bridge.fetchContextPack',
    family: 'bridge',
    builtIn: false,
    handlerMode: 'custom',
    summary: 'Fetch a run-scoped context pack for local bridge clients.',
    payloadShape: {
      runId: 'string',
    },
    resultShape: {
      mode: 'string',
      view: 'object',
      pack: 'object?',
    },
  },
  'bridge.submitNodeRun': {
    taskType: 'bridge.submitNodeRun',
    family: 'bridge',
    builtIn: false,
    handlerMode: 'custom',
    summary: 'Submit a snapshot-backed node run through the bridge workflow.',
    payloadShape: {
      projectId: 'string',
      nodeId: 'string',
      force: 'boolean?',
      preflightOnly: 'boolean?',
      searchTrialCount: 'number?',
      clarifyMessages: 'array?',
      workspaceSnapshot: 'object?',
      localSnapshot: 'object?',
    },
    resultShape: {
      bridgeVersion: 'string',
      mode: 'string',
      run: 'object?',
      attempt: 'object?',
      execution: 'object?',
      followUp: 'object?',
      contextPack: 'object?',
      runPayloadPreview: 'object?',
    },
  },
  'bridge.fetchRunReport': {
    taskType: 'bridge.fetchRunReport',
    family: 'bridge',
    builtIn: false,
    handlerMode: 'custom',
    summary: 'Fetch a compact bridge-friendly run report summary.',
    payloadShape: {
      runId: 'string',
    },
    resultShape: {
      bridgeVersion: 'string',
      runId: 'string',
      attempt: 'object?',
      counts: 'object',
      contract: 'object?',
      snapshots: 'object?',
    },
  },
  'bridge.submitRunNote': {
    taskType: 'bridge.submitRunNote',
    family: 'bridge',
    builtIn: false,
    handlerMode: 'custom',
    summary: 'Submit a markdown bridge note as a run artifact.',
    payloadShape: {
      runId: 'string',
      content: 'string',
      title: 'string?',
    },
    resultShape: {
      ok: 'boolean',
      runId: 'string',
      artifact: 'object?',
    },
  },
};

function cloneDescriptor(descriptor = null) {
  if (!descriptor || typeof descriptor !== 'object') return null;
  return {
    ...descriptor,
    payloadShape: descriptor.payloadShape && typeof descriptor.payloadShape === 'object'
      ? { ...descriptor.payloadShape }
      : {},
    resultShape: descriptor.resultShape && typeof descriptor.resultShape === 'object'
      ? { ...descriptor.resultShape }
      : {},
  };
}

function normalizeDaemonTaskTypes(taskTypes = []) {
  const seen = new Set();
  const normalized = [];
  for (const raw of Array.isArray(taskTypes) ? taskTypes : []) {
    const taskType = String(raw || '').trim();
    if (!taskType || seen.has(taskType) || !TASK_DESCRIPTOR_MAP[taskType]) continue;
    seen.add(taskType);
    normalized.push(taskType);
  }
  return normalized;
}

function daemonSupportsTaskTypes(daemon = null, taskTypes = []) {
  const required = normalizeDaemonTaskTypes(taskTypes);
  if (required.length === 0) return true;
  const advertised = normalizeDaemonTaskTypes(daemon && typeof daemon === 'object' ? daemon.supportedTaskTypes : []);
  if (advertised.length === 0) {
    return required.every((taskType) => BUILT_IN_DAEMON_TASK_TYPES.includes(taskType));
  }
  return required.every((taskType) => advertised.includes(taskType));
}

function missingDaemonTaskTypes(daemon = null, taskTypes = []) {
  return normalizeDaemonTaskTypes(taskTypes)
    .filter((taskType) => !daemonSupportsTaskTypes(daemon, [taskType]));
}

function buildDaemonTaskDescriptor(taskType = '') {
  const key = String(taskType || '').trim();
  return cloneDescriptor(TASK_DESCRIPTOR_MAP[key]);
}

function contextualizeDaemonTaskDescriptor(taskType = '', {
  supportedTaskTypes = [],
  request = null,
} = {}) {
  const descriptor = buildDaemonTaskDescriptor(taskType);
  if (!descriptor) return null;
  const normalizedSupportedTaskTypes = normalizeDaemonTaskTypes(supportedTaskTypes);
  const hasRequest = request && typeof request === 'object' && typeof request.path === 'string' && request.path.trim();
  const isBridgeTask = String(taskType || '').trim().startsWith('bridge.');
  if (isBridgeTask && (normalizedSupportedTaskTypes.includes(taskType) || hasRequest)) {
    descriptor.handlerMode = 'builtin-http-proxy';
  }
  return descriptor;
}

function listDaemonTaskDescriptors() {
  return [
    ...BUILT_IN_DAEMON_TASK_TYPES,
    ...OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  ].map((taskType) => buildDaemonTaskDescriptor(taskType)).filter(Boolean);
}

module.exports = {
  BUILT_IN_DAEMON_TASK_TYPES,
  OPTIONAL_BRIDGE_DAEMON_TASK_TYPES,
  DAEMON_TASK_CATALOG_VERSION,
  daemonSupportsTaskTypes,
  missingDaemonTaskTypes,
  normalizeDaemonTaskTypes,
  buildDaemonTaskDescriptor,
  contextualizeDaemonTaskDescriptor,
  listDaemonTaskDescriptors,
};
