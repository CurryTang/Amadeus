const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');
const {
  normalizePlan,
  validatePlanGraph,
  applyPlanPatches,
  calculateImpact,
} = require('./plan-patch.service');
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

function ensureProjectPath(project = {}) {
  const projectPath = cleanString(project.projectPath);
  if (!projectPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }
  return projectPath;
}

function getResearchOpsRoot(projectPath = '') {
  const normalized = String(projectPath || '').replace(/\/+$/, '');
  if (!normalized) return '.researchops';
  return `${normalized}/.researchops`;
}

function getResearchOpsPaths(projectPath = '') {
  const root = getResearchOpsRoot(projectPath);
  return {
    root,
    planPath: `${root}/plan.yaml`,
    statePath: `${root}/state.json`,
    cachePath: `${root}/cache`,
  };
}

function buildDefaultPlan(project = {}) {
  const projectName = cleanString(project.name) || cleanString(project.id) || 'AutoResearch';
  return normalizePlan({
    version: 1,
    project: projectName,
    vars: {},
    nodes: [
      {
        id: 'init',
        title: 'Project bootstrap',
        kind: 'setup',
        assumption: ['Project path is accessible'],
        target: ['Repository and environment baseline verified'],
        commands: [],
        checks: [],
        git: {
          base: 'HEAD',
        },
      },
    ],
  });
}

async function readLocalPlan(planPath, fallbackPlan) {
  try {
    const raw = await fs.readFile(planPath, 'utf8');
    const parsed = yaml.load(raw) || {};
    return normalizePlan(parsed);
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizePlan(fallbackPlan);
    throw error;
  }
}

async function readLocalPlanWithSource(planPath, fallbackPlan) {
  try {
    const raw = await fs.readFile(planPath, 'utf8');
    const parsed = yaml.load(raw) || {};
    return {
      plan: normalizePlan(parsed),
      source: 'cache',
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        plan: normalizePlan(fallbackPlan),
        source: 'fallback',
      };
    }
    throw error;
  }
}

async function writeLocalPlan(planPath, plan) {
  const dir = path.dirname(planPath);
  await fs.mkdir(dir, { recursive: true });
  const serialized = yaml.dump(plan, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  });
  await fs.writeFile(planPath, serialized, 'utf8');
}

async function readRemotePlan(server, planPath, fallbackPlan) {
  const script = [
    'set -eu',
    'PLAN_PATH="$1"',
    'if [ ! -f "$PLAN_PATH" ]; then',
    '  echo "__NOT_FOUND__"',
    '  exit 0',
    'fi',
    'printf "__B64__:"',
    'base64 < "$PLAN_PATH" | tr -d "\\n"',
    'echo',
  ].join('\n');

  try {
    const { stdout } = await runSshCommand(server, ['bash', '-s', '--', planPath], {
      timeoutMs: 30000,
      input: `${script}\n`,
    });
    const output = String(stdout || '');
    if (output.includes('__NOT_FOUND__')) return normalizePlan(fallbackPlan);
    const line = output.split(/\r?\n/).find((item) => item.startsWith('__B64__:')) || '';
    const encoded = line.slice('__B64__:'.length).trim();
    if (!encoded) return normalizePlan(fallbackPlan);
    const raw = Buffer.from(encoded, 'base64').toString('utf8');
    const parsed = yaml.load(raw) || {};
    return normalizePlan(parsed);
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message);
    wrapped.code = mapped.code;
    throw wrapped;
  }
}

async function writeRemotePlan(server, planPath, plan) {
  const serialized = yaml.dump(plan, {
    noRefs: true,
    lineWidth: 120,
    sortKeys: false,
  });
  const encoded = Buffer.from(serialized, 'utf8').toString('base64');
  const script = [
    'set -eu',
    'PLAN_PATH="$1"',
    'CONTENT_B64="$2"',
    'PLAN_DIR="$(dirname "$PLAN_PATH")"',
    'mkdir -p "$PLAN_DIR"',
    'printf "%s" "$CONTENT_B64" | base64 -d > "$PLAN_PATH"',
    'echo "__OK__"',
  ].join('\n');

  try {
    await runSshCommand(server, ['bash', '-s', '--', planPath, encoded], {
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

async function readProjectPlan({ project, server = null }) {
  const projectPath = ensureProjectPath(project);
  const paths = getResearchOpsPaths(projectPath);
  const mirrorPaths = getLocalMirrorPaths(project);
  const fallbackPlan = buildDefaultPlan(project);
  let plan = null;
  let degraded = null;

  if (project.locationType === 'ssh') {
    try {
      plan = await readRemotePlan(server, paths.planPath, fallbackPlan);
      await writeLocalPlan(mirrorPaths.planPath, plan).catch(() => {});
    } catch (error) {
      const code = cleanString(error?.code).toUpperCase();
      if (!code.startsWith('SSH_')) throw error;
      const mirror = await readLocalPlanWithSource(mirrorPaths.planPath, fallbackPlan);
      plan = mirror.plan;
      degraded = {
        enabled: true,
        source: mirror.source === 'cache' ? 'local_cache' : 'fallback_default',
        code: code || 'SSH_COMMAND_FAILED',
        message: cleanString(error?.message) || 'SSH unavailable, loaded fallback plan',
      };
    }
  } else {
    plan = await readLocalPlan(path.resolve(expandHome(paths.planPath)), fallbackPlan);
    await writeLocalPlan(mirrorPaths.planPath, plan).catch(() => {});
  }

  const validation = validatePlanGraph(plan);
  return {
    plan,
    validation,
    paths: {
      ...paths,
      mirrorPlanPath: mirrorPaths.planPath,
    },
    degraded,
  };
}

async function writeProjectPlan({ project, server = null, plan }) {
  const projectPath = ensureProjectPath(project);
  const paths = getResearchOpsPaths(projectPath);
  const mirrorPaths = getLocalMirrorPaths(project);
  const normalized = normalizePlan(plan || {});
  const validation = validatePlanGraph(normalized);
  if (!validation.valid) {
    const error = new Error('Plan validation failed');
    error.code = 'PLAN_SCHEMA_INVALID';
    error.validation = validation;
    throw error;
  }
  let degraded = null;
  if (project.locationType === 'ssh') {
    try {
      await writeRemotePlan(server, paths.planPath, normalized);
    } catch (error) {
      const code = cleanString(error?.code).toUpperCase();
      if (!code.startsWith('SSH_')) throw error;
      degraded = {
        enabled: true,
        source: 'local_cache_only',
        code: code || 'SSH_COMMAND_FAILED',
        message: cleanString(error?.message) || 'SSH unavailable, plan persisted to local mirror cache',
      };
    }
  } else {
    await writeLocalPlan(path.resolve(expandHome(paths.planPath)), normalized);
  }
  await writeLocalPlan(mirrorPaths.planPath, normalized).catch(() => {});
  return {
    plan: normalized,
    validation,
    paths: {
      ...paths,
      mirrorPlanPath: mirrorPaths.planPath,
    },
    degraded,
  };
}

async function applyProjectPlanPatches({ project, server = null, patches = [], state = {} }) {
  const current = await readProjectPlan({ project, server });
  const result = applyPlanPatches(current.plan, patches, state);
  const impact = calculateImpact(current.plan, result.plan, state);
  await writeProjectPlan({ project, server, plan: result.plan });
  return {
    ...result,
    impact,
    previousPlan: current.plan,
  };
}

function validateProjectPlan(plan = {}) {
  const normalized = normalizePlan(plan);
  return {
    plan: normalized,
    validation: validatePlanGraph(normalized),
  };
}

function previewPlanImpact({ basePlan = {}, patches = [], state = {} }) {
  const normalized = normalizePlan(basePlan);
  const patched = applyPlanPatches(normalized, patches, state);
  const impact = calculateImpact(normalized, patched.plan, state);
  return {
    ...patched,
    impact,
  };
}

module.exports = {
  getResearchOpsPaths,
  buildDefaultPlan,
  readProjectPlan,
  writeProjectPlan,
  applyProjectPlanPatches,
  validateProjectPlan,
  previewPlanImpact,
};
