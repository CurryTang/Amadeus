const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const s3Service = require('../s3.service');
const {
  runSshCommand,
  classifySshError,
} = require('../ssh-auth.service');

const SKILL_NAME = 'deliverable-step-report';
const SKILL_ROOT = path.join(__dirname, '..', '..', '..', '..', 'skills', SKILL_NAME);
const TEMPLATE_PATH = path.join(SKILL_ROOT, 'template.md');
const GUIDELINE_PATH = path.join(SKILL_ROOT, 'reference', 'x_guideline.md');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function sanitizePathSegment(input = '', fallback = 'unknown') {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function listToBullets(items = []) {
  const array = Array.isArray(items) ? items : [];
  const normalized = array
    .map((item) => cleanString(String(item || '')))
    .filter(Boolean);
  if (normalized.length === 0) return '- (none)';
  return normalized.map((item) => `- ${item}`).join('\n');
}

function renderTemplate(template = '', data = {}) {
  const fallback = String(template || '');
  return fallback.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, token) => {
    const pathTokens = String(token || '')
      .split('.')
      .map((item) => item.trim())
      .filter(Boolean);
    let cursor = data;
    for (const part of pathTokens) {
      if (!cursor || typeof cursor !== 'object' || !(part in cursor)) {
        return '';
      }
      cursor = cursor[part];
    }
    if (cursor === null || cursor === undefined) return '';
    if (typeof cursor === 'string' || typeof cursor === 'number' || typeof cursor === 'boolean') {
      return String(cursor);
    }
    return '';
  });
}

function buildDefaultTemplate() {
  return [
    '# Step Deliverable Report',
    '',
    '- project: {{project.name}} ({{project.id}})',
    '- node: {{node.title}} ({{node.id}})',
    '- run_id: {{run.id}}',
    '- run_status: {{run.status}}',
    '- generated_at: {{meta.generated_at}}',
    '- base_commit: {{run_intent.base_commit}}',
    '',
    '## Goal',
    '{{run_intent.goal.summary}}',
    '',
    '## Assumptions',
    '{{meta.assumptions_md}}',
    '',
    '## Commands',
    '{{meta.commands_md}}',
    '',
    '## Acceptance Checks',
    '{{meta.checks_md}}',
    '',
    '## Dependencies',
    '{{meta.deps_md}}',
    '',
    '## Failure Signature',
    '- type: {{run_intent.failure_signature.type}}',
    '- signature: {{run_intent.failure_signature.signature}}',
    '- message: {{run_intent.failure_signature.message}}',
    '',
    '## Context Pack',
    '- generated_at: {{context_pack.generated_at}}',
    '- selected_items: {{context_pack.selected_count}}',
    '',
    '## Notes',
    '{{meta.notes}}',
    '',
  ].join('\n');
}

async function loadSkillAssets() {
  let template = '';
  let guideline = '';
  try {
    template = await fs.readFile(TEMPLATE_PATH, 'utf8');
  } catch (_) {
    template = buildDefaultTemplate();
  }
  try {
    guideline = await fs.readFile(GUIDELINE_PATH, 'utf8');
  } catch (_) {
    guideline = '';
  }
  return { template, guideline };
}

function buildReportPath(projectPath = '', nodeId = '', runId = '') {
  const root = String(projectPath || '').replace(/\/+$/, '');
  const safeNodeId = sanitizePathSegment(nodeId, 'node');
  const safeRunId = sanitizePathSegment(runId, 'run');
  return `${root}/.researchops/deliverables/${safeNodeId}/${safeRunId}.md`;
}

async function writeLocalReport(filePath = '', markdown = '') {
  const absolute = path.resolve(expandHome(filePath));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, String(markdown || ''), 'utf8');
}

async function writeRemoteReport(server, filePath = '', markdown = '') {
  const encoded = Buffer.from(String(markdown || ''), 'utf8').toString('base64');
  const script = [
    'set -eu',
    'TARGET="$1"',
    'CONTENT_B64="$2"',
    'mkdir -p "$(dirname "$TARGET")"',
    'printf "%s" "$CONTENT_B64" | base64 -d > "$TARGET"',
    'echo "__OK__"',
  ].join('\n');
  try {
    await runSshCommand(server, ['bash', '-s', '--', filePath, encoded], {
      timeoutMs: 45000,
      input: `${script}\n`,
    });
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message || String(error?.message || 'SSH report upload failed'));
    wrapped.code = mapped.code || 'SSH_COMMAND_FAILED';
    throw wrapped;
  }
}

async function uploadReportObject(runId = '', nodeId = '', markdown = '') {
  const safeRunId = cleanString(runId);
  const safeNodeId = sanitizePathSegment(nodeId, 'node');
  if (!safeRunId) return { objectKey: null, objectUrl: null };
  const objectKey = `runs/${safeRunId}/deliverables/${safeNodeId}-report.md`;
  try {
    const upload = await s3Service.uploadBuffer(
      Buffer.from(String(markdown || ''), 'utf8'),
      objectKey,
      'text/markdown'
    );
    return {
      objectKey,
      objectUrl: upload?.location || null,
    };
  } catch (_) {
    return { objectKey: null, objectUrl: null };
  }
}

function buildRenderData({
  project = {},
  node = {},
  run = {},
  runIntent = {},
  contextPack = null,
  commands = [],
  treeState = {},
  guideline = '',
} = {}) {
  const assumptions = Array.isArray(runIntent?.assumptions)
    ? runIntent.assumptions
    : (Array.isArray(node?.assumption) ? node.assumption : []);
  const checks = Array.isArray(runIntent?.acceptance_checks)
    ? runIntent.acceptance_checks.map((item) => item?.name || item?.type || '')
    : (Array.isArray(node?.checks) ? node.checks.map((item) => item?.name || item?.type || '') : []);
  const deps = Array.isArray(runIntent?.deps) ? runIntent.deps : [];
  const queueStatus = cleanString(treeState?.nodes?.[node?.id]?.status).toUpperCase();

  return {
    project: {
      id: cleanString(project?.id),
      name: cleanString(project?.name),
      path: cleanString(project?.projectPath),
      location_type: cleanString(project?.locationType || 'local'),
      server_id: cleanString(project?.serverId || ''),
    },
    node: {
      id: cleanString(node?.id),
      title: cleanString(node?.title),
      kind: cleanString(node?.kind || 'experiment'),
    },
    run: {
      id: cleanString(run?.id),
      status: cleanString(run?.status || 'QUEUED'),
      created_at: cleanString(run?.createdAt || ''),
      queue_status: queueStatus || 'PLANNED',
    },
    run_intent: {
      ...runIntent,
      goal: runIntent?.goal && typeof runIntent.goal === 'object'
        ? runIntent.goal
        : {
          summary: cleanString(node?.title || node?.id || ''),
        },
      failure_signature: runIntent?.failure_signature && typeof runIntent.failure_signature === 'object'
        ? runIntent.failure_signature
        : {
          type: 'unknown',
          signature: '',
          message: '',
        },
    },
    context_pack: {
      generated_at: cleanString(contextPack?.generatedAt || ''),
      selected_count: Number.isFinite(Number(contextPack?.selected_items?.length))
        ? Number(contextPack.selected_items.length)
        : 0,
    },
    meta: {
      generated_at: new Date().toISOString(),
      assumptions_md: listToBullets(assumptions),
      commands_md: listToBullets(commands),
      checks_md: listToBullets(checks),
      deps_md: listToBullets(deps),
      notes: queueStatus === 'RUNNING'
        ? 'Step is in progress. Update report after completion if needed.'
        : 'Step has been queued; this report captures execution intent and acceptance contract.',
      guideline_excerpt: cleanString(guideline).slice(0, 1200),
    },
  };
}

async function createDeliverableReportForRun({
  project = {},
  server = null,
  node = {},
  run = {},
  runIntent = {},
  contextPack = null,
  treeState = {},
  commands = [],
} = {}) {
  const projectPath = cleanString(project?.projectPath);
  if (!projectPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  const { template, guideline } = await loadSkillAssets();
  const renderData = buildRenderData({
    project,
    node,
    run,
    runIntent,
    contextPack,
    treeState,
    commands,
    guideline,
  });

  const markdown = renderTemplate(template, renderData);
  const reportPath = buildReportPath(projectPath, node?.id, run?.id);

  if (String(project?.locationType || '').toLowerCase() === 'ssh') {
    await writeRemoteReport(server, reportPath, markdown);
  } else {
    await writeLocalReport(reportPath, markdown);
  }

  const objectResult = await uploadReportObject(run?.id, node?.id, markdown);
  return {
    skillName: SKILL_NAME,
    reportPath,
    markdown,
    objectKey: objectResult.objectKey,
    objectUrl: objectResult.objectUrl,
    templatePath: TEMPLATE_PATH,
    guidelinePath: GUIDELINE_PATH,
  };
}

module.exports = {
  SKILL_NAME,
  TEMPLATE_PATH,
  GUIDELINE_PATH,
  createDeliverableReportForRun,
};
