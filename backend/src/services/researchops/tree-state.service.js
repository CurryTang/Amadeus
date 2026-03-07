const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const {
  getResearchOpsPaths,
} = require('./tree-plan.service');
const {
  runSshCommand,
  classifySshError,
} = require('../ssh-auth.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function sanitizeSegment(value = '', fallback = 'project') {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function getLocalMirrorPaths(project = {}) {
  const projectToken = sanitizeSegment(cleanString(project.id) || cleanString(project.name), 'project');
  const root = path.join(os.homedir(), '.researchops', 'tree-cache', projectToken);
  return {
    root,
    planPath: path.join(root, 'plan.yaml'),
    statePath: path.join(root, 'state.json'),
  };
}

function buildDefaultState() {
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
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(state = {}) {
  const base = buildDefaultState();
  return {
    ...base,
    ...state,
    nodes: state?.nodes && typeof state.nodes === 'object' ? state.nodes : {},
    runs: state?.runs && typeof state.runs === 'object' ? state.runs : {},
    queue: {
      ...base.queue,
      ...(state?.queue && typeof state.queue === 'object' ? state.queue : {}),
      items: Array.isArray(state?.queue?.items) ? state.queue.items : [],
    },
    search: state?.search && typeof state.search === 'object' ? state.search : {},
    updatedAt: cleanString(state?.updatedAt) || new Date().toISOString(),
  };
}

function normalizeNodeStatePatch(patch = {}) {
  const next = {
    ...patch,
  };
  if (Object.prototype.hasOwnProperty.call(next, 'status')) {
    next.status = cleanString(next.status).toUpperCase() || undefined;
  }
  if (Object.prototype.hasOwnProperty.call(next, 'manualApproved')) {
    next.manualApproved = Boolean(next.manualApproved);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'search')) {
    next.search = next.search && typeof next.search === 'object' && !Array.isArray(next.search)
      ? next.search
      : {};
  }
  return next;
}

async function readLocalState(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error?.code === 'ENOENT') return buildDefaultState();
    throw error;
  }
}

async function writeLocalState(filePath, state) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
}

async function readRemoteState(server, statePath) {
  const script = [
    'set -eu',
    'STATE_PATH="$1"',
    'if [ ! -f "$STATE_PATH" ]; then',
    '  echo "__NOT_FOUND__"',
    '  exit 0',
    'fi',
    'printf "__B64__:"',
    'base64 < "$STATE_PATH" | tr -d "\\n"',
    'echo',
  ].join('\n');

  try {
    const { stdout } = await runSshCommand(server, ['bash', '-s', '--', statePath], {
      timeoutMs: 30000,
      input: `${script}\n`,
    });
    const output = String(stdout || '');
    if (output.includes('__NOT_FOUND__')) return buildDefaultState();
    const line = output.split(/\r?\n/).find((item) => item.startsWith('__B64__:')) || '';
    const encoded = line.slice('__B64__:'.length).trim();
    if (!encoded) return buildDefaultState();
    const raw = Buffer.from(encoded, 'base64').toString('utf8');
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message);
    wrapped.code = mapped.code;
    throw wrapped;
  }
}

async function writeRemoteState(server, statePath, state) {
  const normalized = normalizeState(state);
  const encoded = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8').toString('base64');
  const script = [
    'set -eu',
    'STATE_PATH="$1"',
    'CONTENT_B64="$2"',
    'STATE_DIR="$(dirname "$STATE_PATH")"',
    'mkdir -p "$STATE_DIR"',
    'printf "%s" "$CONTENT_B64" | base64 -d > "$STATE_PATH"',
    'echo "__OK__"',
  ].join('\n');

  try {
    await runSshCommand(server, ['bash', '-s', '--', statePath, encoded], {
      timeoutMs: 45000,
      input: `${script}\n`,
    });
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message);
    wrapped.code = mapped.code;
    throw wrapped;
  }
}

async function readProjectState({ project, server = null }) {
  const paths = getResearchOpsPaths(project.projectPath || '');
  const mirrorPaths = getLocalMirrorPaths(project);
  let state = null;
  let degraded = null;

  if (project.locationType === 'ssh') {
    try {
      state = await readRemoteState(server, paths.statePath);
      await writeLocalState(mirrorPaths.statePath, state).catch(() => {});
    } catch (error) {
      const code = cleanString(error?.code).toUpperCase();
      if (!code.startsWith('SSH_')) throw error;
      state = await readLocalState(mirrorPaths.statePath);
      degraded = {
        enabled: true,
        source: 'local_cache',
        code: code || 'SSH_COMMAND_FAILED',
        message: cleanString(error?.message) || 'SSH unavailable, loaded cached state',
      };
    }
  } else {
    const filePath = path.resolve(expandHome(paths.statePath));
    state = await readLocalState(filePath);
    await writeLocalState(mirrorPaths.statePath, state).catch(() => {});
  }
  return {
    state,
    paths: {
      ...paths,
      mirrorStatePath: mirrorPaths.statePath,
    },
    degraded,
  };
}

async function writeProjectState({ project, server = null, state }) {
  const paths = getResearchOpsPaths(project.projectPath || '');
  const mirrorPaths = getLocalMirrorPaths(project);
  const normalized = normalizeState({
    ...state,
    updatedAt: new Date().toISOString(),
  });
  let degraded = null;
  if (project.locationType === 'ssh') {
    try {
      await writeRemoteState(server, paths.statePath, normalized);
    } catch (error) {
      const code = cleanString(error?.code).toUpperCase();
      if (!code.startsWith('SSH_')) throw error;
      degraded = {
        enabled: true,
        source: 'local_cache_only',
        code: code || 'SSH_COMMAND_FAILED',
        message: cleanString(error?.message) || 'SSH unavailable, state persisted to local mirror cache',
      };
    }
  } else {
    const filePath = path.resolve(expandHome(paths.statePath));
    await writeLocalState(filePath, normalized);
  }
  await writeLocalState(mirrorPaths.statePath, normalized).catch(() => {});
  return {
    state: normalized,
    paths: {
      ...paths,
      mirrorStatePath: mirrorPaths.statePath,
    },
    degraded,
  };
}

async function patchProjectState({ project, server = null, mutate }) {
  const current = await readProjectState({ project, server });
  const next = typeof mutate === 'function'
    ? (mutate(normalizeState(current.state)) || current.state)
    : current.state;
  return writeProjectState({ project, server, state: next });
}

function setNodeState(state, nodeId, patch = {}) {
  const id = cleanString(nodeId);
  if (!id) return state;
  const next = normalizeState(state);
  const normalizedPatch = normalizeNodeStatePatch(patch);
  next.nodes[id] = {
    ...(next.nodes[id] && typeof next.nodes[id] === 'object' ? next.nodes[id] : {}),
    ...normalizedPatch,
    updatedAt: new Date().toISOString(),
  };
  next.updatedAt = new Date().toISOString();
  return next;
}

function appendQueueItem(state, item = {}) {
  const next = normalizeState(state);
  next.queue.items = [
    ...(Array.isArray(next.queue.items) ? next.queue.items : []),
    {
      ...item,
      queuedAt: cleanString(item.queuedAt) || new Date().toISOString(),
    },
  ].slice(-1000);
  next.queue.updatedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  return next;
}

function setQueuePaused(state, paused, reason = '') {
  const next = normalizeState(state);
  next.queue.paused = Boolean(paused);
  next.queue.pausedReason = cleanString(reason);
  next.queue.updatedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  return next;
}

module.exports = {
  buildDefaultState,
  normalizeState,
  readProjectState,
  writeProjectState,
  patchProjectState,
  setNodeState,
  appendQueueItem,
  setQueuePaused,
};
