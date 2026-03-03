const fs = require('fs/promises');
const path = require('path');
const codexCliService = require('../codex-cli.service');
const geminiCliService = require('../gemini-cli.service');
const llmService = require('../llm.service');
const knowledgeAssetsService = require('./knowledge-assets.service');
const knowledgeGroupsService = require('../knowledge-groups.service');
const {
  runSshCommand,
  classifySshError,
} = require('../ssh-auth.service');

const MAX_STEPS = 12;
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MODEL_TIMEOUT_MS = 50000;
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their',
  'then', 'this', 'to', 'up', 'with', 'without', 'will', 'can', 'could', 'should',
  'would', 'use', 'using', 'via', 'step', 'task', 'todo', 'project', 'module',
  'analysis', 'implement', 'implementation', 'run', 'runs', 'build', 'create',
  'make', 'needs', 'need', 'check', 'checks', 'target', 'targets', 'assumption',
  'assumptions', 'command', 'commands', 'acceptance', 'criteria', 'based',
]);
const STEP_KIND_SET = new Set(['setup', 'knowledge', 'experiment', 'analysis', 'milestone', 'search', 'patch']);
const CODE_PATH_PATTERN = /(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_.-]+)?/g;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampInt(value, fallback, min = 0, max = 100000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function parseJsonArrayFromModelOutput(rawText = '') {
  const source = String(rawText || '').trim();
  if (!source) return [];

  try {
    const parsed = JSON.parse(source);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {}

  const fenceMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(String(fenceMatch[1] || '').trim());
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }

  const arrayMatch = source.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
  }
  return [];
}

function parseJsonObjectFromModelOutput(rawText = '') {
  const source = String(rawText || '').trim();
  if (!source) return null;

  try {
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {}

  const fenceMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(String(fenceMatch[1] || '').trim());
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {}
  }

  const objectMatch = source.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {}
  }
  return null;
}

function normalizePriority(value = '', index = 0) {
  const raw = cleanString(value).toLowerCase();
  if (['high', 'medium', 'low'].includes(raw)) return raw;
  if (index < 2) return 'high';
  if (index < 6) return 'medium';
  return 'low';
}

function normalizeStringList(value = []) {
  const out = [];
  const seen = new Set();
  toArray(value).forEach((item) => {
    const text = cleanString(item);
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function inferStepKind(rawKind = '', text = '') {
  const fromKind = cleanString(rawKind).toLowerCase();
  if (STEP_KIND_SET.has(fromKind)) return fromKind;

  const source = String(text || '').toLowerCase();
  if (/\b(search|mcts|beam|best[-_ ]?first|hyperband|sweep|trial)\b/.test(source)) return 'search';
  if (/\b(milestone|approve|review|gate|decision)\b/.test(source)) return 'milestone';
  if (/\b(knowledge|paper|literature|kb|reference|read)\b/.test(source)) return 'knowledge';
  if (/\b(analysis|report|visuali|summar|compare|ablation table)\b/.test(source)) return 'analysis';
  if (/\b(setup|bootstrap|install|prepare|environment|dependency|config)\b/.test(source)) return 'setup';
  if (/\b(patch|fix|refactor|repair)\b/.test(source)) return 'patch';
  return 'experiment';
}

function normalizeCommand(command = {}, index = 0) {
  if (typeof command === 'string') {
    const run = cleanString(command);
    if (!run) return null;
    return {
      name: `cmd_${String(index + 1).padStart(2, '0')}`,
      run,
    };
  }
  if (!command || typeof command !== 'object') return null;
  const run = cleanString(command.run || command.command || command.cmd);
  if (!run) return null;
  return {
    name: cleanString(command.name) || `cmd_${String(index + 1).padStart(2, '0')}`,
    run,
  };
}

function normalizeCheck(check = {}, index = 0) {
  if (typeof check === 'string') {
    const text = cleanString(check);
    if (!text) return null;
    return {
      name: `check_${String(index + 1).padStart(2, '0')}`,
      type: 'manual_approve',
      note: text,
    };
  }
  if (!check || typeof check !== 'object') return null;
  const type = cleanString(check.type || check.kind || 'manual_approve').toLowerCase();
  const allowedType = [
    'file_exists',
    'glob_exists',
    'metric_threshold',
    'unit_tests',
    'regex_in_log',
    'regex_not_in_log',
    'manual_approve',
    'artifact_compare',
  ].includes(type)
    ? type
    : 'manual_approve';

  const normalized = {
    name: cleanString(check.name) || `check_${String(index + 1).padStart(2, '0')}`,
    type: allowedType,
  };

  ['path', 'file', 'key', 'pattern', 'minutes'].forEach((field) => {
    if (check[field] !== undefined && check[field] !== null && check[field] !== '') {
      normalized[field] = typeof check[field] === 'number' ? check[field] : cleanString(check[field]);
    }
  });
  if (check.gte !== undefined && check.gte !== null && check.gte !== '') {
    const gte = Number(check.gte);
    normalized.gte = Number.isFinite(gte) ? gte : cleanString(check.gte);
  }
  if (check.lte !== undefined && check.lte !== null && check.lte !== '') {
    const lte = Number(check.lte);
    normalized.lte = Number.isFinite(lte) ? lte : cleanString(check.lte);
  }
  return normalized;
}

function toStepId(value = '', index = 0) {
  const raw = cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9_\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (raw) return raw.slice(0, 48);
  return `step_${String(index + 1).padStart(2, '0')}`;
}

function normalizeStep(rawStep = {}, index = 0) {
  const title = cleanString(
    rawStep.title
    || rawStep.name
    || rawStep.step
    || rawStep.label
    || `Step ${index + 1}`
  );
  if (!title) return null;

  const objective = cleanString(
    rawStep.objective
    || rawStep.details
    || rawStep.description
    || rawStep.hypothesis
    || title
  );

  const assumptions = normalizeStringList(
    toArray(rawStep.assumptions).length
      ? rawStep.assumptions
      : toArray(rawStep.assumption)
  );

  const acceptance = normalizeStringList(
    toArray(rawStep.acceptance).length
      ? rawStep.acceptance
      : (toArray(rawStep.target).length ? rawStep.target : toArray(rawStep.targets))
  );

  const commandSource = toArray(rawStep.commands).length
    ? rawStep.commands
    : (toArray(rawStep.command).length ? rawStep.command : (rawStep.command ? [rawStep.command] : []));

  const commands = commandSource
    .map((item, cmdIndex) => normalizeCommand(item, cmdIndex))
    .filter(Boolean)
    .slice(0, 8);

  const checks = toArray(rawStep.checks)
    .map((item, checkIndex) => normalizeCheck(item, checkIndex))
    .filter(Boolean)
    .slice(0, 8);

  const deps = normalizeStringList(
    toArray(rawStep.depends_on).length
      ? rawStep.depends_on
      : (toArray(rawStep.deps).length ? rawStep.deps : (rawStep.dep ? [rawStep.dep] : []))
  );

  const kind = inferStepKind(rawStep.kind, `${title} ${objective}`);
  const priority = normalizePriority(rawStep.priority, index);
  const stepId = toStepId(rawStep.step_id || rawStep.id, index);

  return {
    step_id: stepId,
    title: title.slice(0, 140),
    kind,
    objective: objective.slice(0, 1000),
    assumptions,
    acceptance,
    commands,
    checks,
    depends_on_raw: deps,
    priority,
    references: {
      knowledge: [],
      codebase: [],
    },
  };
}

function canonicalKey(text = '') {
  return cleanString(text).toLowerCase();
}

function resolveStepDependencies(steps = []) {
  const byId = new Map();
  const byTitle = new Map();
  steps.forEach((step, index) => {
    const id = cleanString(step.step_id) || `step_${String(index + 1).padStart(2, '0')}`;
    byId.set(canonicalKey(id), id);
    byTitle.set(canonicalKey(step.title), id);
  });

  return steps.map((step, index) => {
    const resolved = [];
    const seen = new Set();
    toArray(step.depends_on_raw).forEach((dep) => {
      const key = canonicalKey(dep);
      if (!key) return;
      let target = byId.get(key) || byTitle.get(key) || '';
      if (!target && /^step\s*\d+$/i.test(dep)) {
        const n = Number(dep.match(/\d+/)?.[0]);
        if (Number.isFinite(n) && n > 0 && n <= steps.length) {
          target = steps[n - 1].step_id;
        }
      }
      if (!target || target === step.step_id) return;
      if (seen.has(target)) return;
      seen.add(target);
      resolved.push(target);
    });

    // Default to linear chain when no explicit dependency is provided.
    if (resolved.length === 0 && index > 0) {
      resolved.push(steps[index - 1].step_id);
    }

    return {
      ...step,
      depends_on: resolved,
    };
  });
}

function parseStepsFromModelOutput(rawText = '') {
  const parsedObject = parseJsonObjectFromModelOutput(rawText);
  if (parsedObject) {
    if (Array.isArray(parsedObject.steps)) return parsedObject.steps;
    if (Array.isArray(parsedObject.tasks)) return parsedObject.tasks;
    if (Array.isArray(parsedObject.nodes)) return parsedObject.nodes;
  }
  return parseJsonArrayFromModelOutput(rawText);
}

function extractKeywords(text = '') {
  const out = [];
  const seen = new Set();
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9_.\-/]{3,}/g) || [];
  tokens.forEach((token) => {
    const normalized = token
      .replace(/^[-_.]+|[-_.]+$/g, '')
      .trim();
    if (!normalized || STOPWORDS.has(normalized)) return;
    if (/^\d+$/.test(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out.slice(0, 36);
}

function countKeywordMatches(haystack = '', keywords = []) {
  const text = String(haystack || '').toLowerCase();
  if (!text) return 0;
  let score = 0;
  keywords.forEach((keyword) => {
    if (!keyword) return;
    if (text.includes(keyword)) score += 1;
  });
  return score;
}

function buildStepSearchText(step = {}) {
  const commandText = toArray(step.commands).map((item) => cleanString(item?.run)).filter(Boolean).join(' ');
  return [
    cleanString(step.title),
    cleanString(step.objective),
    toArray(step.assumptions).join(' '),
    toArray(step.acceptance).join(' '),
    commandText,
  ].filter(Boolean).join(' ');
}

function isOpenRfmContext(instruction = '', project = null) {
  const source = [
    cleanString(instruction),
    cleanString(project?.name),
    cleanString(project?.description),
    cleanString(project?.projectPath),
  ].join(' ').toLowerCase();
  return /\b(openrfm|rfmbench|relbench|orig_rt_pl|ddp_smoke)\b/.test(source);
}

function buildPromptHintList(items = [], maxItems = 16, formatter = (item) => String(item || '')) {
  const out = [];
  const seen = new Set();
  toArray(items).forEach((item) => {
    if (out.length >= maxItems) return;
    const text = cleanString(formatter(item));
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text);
  });
  return out;
}

function sanitizeProposalArtifacts(text = '') {
  const source = String(text || '');
  return source
    .replace(/`[^`]*test\/proj1[^`]*`/gi, '')
    .replace(/\bproj1\b/gi, '')
    .replace(/\bconvert_proj1_to_dsl\b/gi, '')
    .replace(/\/egr\/research-dselab\/testuser\/AutoRDL\/dsl\/proj1_scaling_study\.json/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPathTokens(text = '') {
  const matches = String(text || '').match(CODE_PATH_PATTERN) || [];
  return [...new Set(matches.map((item) => cleanString(item)).filter(Boolean))];
}

function toReferenceReason(matches = [], fallback = '') {
  const unique = [];
  const seen = new Set();
  matches.forEach((item) => {
    const text = cleanString(item);
    if (!text) return;
    if (seen.has(text)) return;
    seen.add(text);
    unique.push(text);
  });
  if (unique.length === 0) return fallback || 'Matched by semantic overlap';
  return `Matched keywords: ${unique.slice(0, 5).join(', ')}`;
}

async function listLocalProjectFiles(projectPath, {
  maxFiles = 350,
  maxDepth = 4,
} = {}) {
  const root = cleanString(projectPath);
  if (!root) return [];

  const allowedExt = new Set([
    '.py', '.js', '.ts', '.tsx', '.jsx', '.sh', '.bash', '.zsh', '.yaml', '.yml',
    '.toml', '.json', '.md', '.txt', '.sql', '.ipynb', '.go', '.rs', '.java',
    '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.ini', '.cfg', '.conf',
  ]);
  const allowNames = new Set(['dockerfile', 'makefile', 'readme', 'readme.md']);
  const skipDirs = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.cache', '.mypy_cache']);

  const files = [];
  const queue = [{ abs: root, rel: '', depth: 0 }];

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift();
    let entries = [];
    try {
      // eslint-disable-next-line no-await-in-loop
      entries = await fs.readdir(current.abs, { withFileTypes: true });
    } catch (_) {
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const name = entry.name;
      if (!name) continue;
      const rel = current.rel ? path.posix.join(current.rel, name) : name;
      const abs = path.join(current.abs, name);

      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) continue;
        if (skipDirs.has(name)) continue;
        queue.push({ abs, rel, depth: current.depth + 1 });
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(name).toLowerCase();
      const allow = allowedExt.has(ext) || allowNames.has(name.toLowerCase());
      if (!allow) continue;

      files.push({
        path: rel,
        basename: path.basename(rel),
        source: 'repo_file',
      });
    }
  }

  return files;
}

async function listRemoteProjectFiles(server, projectPath, {
  maxFiles = 350,
  maxDepth = 4,
} = {}) {
  if (!server) return [];
  const rootPath = cleanString(projectPath).replace(/\/$/, '');
  if (!rootPath) return [];

  const cap = clampInt(maxFiles, 350, 40, 600);
  const depth = clampInt(maxDepth, 4, 2, 8);
  const script = [
    'ROOT="$1"',
    'LIMIT="$2"',
    'DEPTH="$3"',
    'if [ -z "$ROOT" ]; then echo "__INVALID_ROOT__"; exit 0; fi',
    'if [ ! -d "$ROOT" ]; then echo "__NOT_DIR__"; exit 0; fi',
    'find "$ROOT" -maxdepth "$DEPTH" -type f \\',
    '  \\( -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.tsx" -o -name "*.jsx" -o -name "*.sh" -o -name "*.yaml" -o -name "*.yml" -o -name "*.toml" -o -name "*.json" -o -name "*.md" -o -name "*.txt" -o -name "*.sql" -o -name "Dockerfile" -o -name "Makefile" -o -name "README" -o -name "README.md" \\) \\',
    '  | sed "s|^$ROOT/||" | head -n "$LIMIT"',
  ].join('\n');

  try {
    const { stdout } = await runSshCommand(
      server,
      ['bash', '-s', '--', rootPath, String(cap), String(depth)],
      { timeoutMs: 45000, input: script }
    );

    const out = cleanString(stdout);
    if (!out || out.includes('__INVALID_ROOT__') || out.includes('__NOT_DIR__')) return [];

    return out
      .split(/\r?\n/)
      .map((line) => cleanString(line))
      .filter(Boolean)
      .map((relative) => ({
        path: relative,
        basename: path.basename(relative),
        source: 'repo_file',
      }));
  } catch (error) {
    const mapped = classifySshError(error);
    if (mapped.code === 'SSH_TIMEOUT' || mapped.code === 'SSH_HOST_UNREACHABLE' || mapped.code === 'SSH_COMMAND_FAILED') {
      return [];
    }
    throw error;
  }
}

async function collectKnowledgeCandidates(userId, project = {}) {
  const groupIds = toArray(project.knowledgeGroupIds)
    .map((item) => Number(item))
    .filter((num) => Number.isFinite(num) && num > 0)
    .slice(0, 6);
  if (groupIds.length === 0) return [];

  const items = [];

  for (const groupId of groupIds) {
    // eslint-disable-next-line no-await-in-loop
    const assets = await knowledgeAssetsService.listKnowledgeGroupAssets(userId, groupId, {
      limit: 40,
      offset: 0,
      includeBody: false,
    }).catch(() => ({ items: [] }));

    toArray(assets.items).forEach((asset) => {
      const title = cleanString(asset?.title);
      if (!title) return;
      items.push({
        id: String(asset.id),
        title,
        summary: cleanString(asset.summary),
        tags: toArray(asset.tags).map((tag) => cleanString(tag)).filter(Boolean),
        source: 'knowledge_asset',
        groupId,
      });
    });

    // eslint-disable-next-line no-await-in-loop
    const docs = await knowledgeGroupsService.listKnowledgeGroupDocuments(userId, groupId, {
      limit: 24,
      offset: 0,
    }).catch(() => ({ items: [] }));

    toArray(docs.items).forEach((doc) => {
      const title = cleanString(doc?.title);
      if (!title) return;
      items.push({
        id: String(doc.id),
        title,
        summary: cleanString(doc.originalUrl),
        tags: toArray(doc.tags).map((tag) => cleanString(tag)).filter(Boolean),
        source: 'knowledge_document',
        groupId,
        url: cleanString(doc.originalUrl),
      });
    });
  }

  const seen = new Set();
  const deduped = [];
  items.forEach((item) => {
    const key = `${item.source}:${cleanString(item.id) || cleanString(item.title).toLowerCase()}`;
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(item);
  });

  return deduped.slice(0, 300);
}

function scoreKnowledgeForStep(step = {}, candidate = {}, keywords = []) {
  const text = [
    cleanString(candidate.title),
    cleanString(candidate.summary),
    toArray(candidate.tags).join(' '),
  ].join(' ').toLowerCase();

  const score = countKeywordMatches(text, keywords);
  if (score <= 0) return null;

  const matched = keywords.filter((kw) => text.includes(kw)).slice(0, 6);
  return {
    id: candidate.id,
    source: candidate.source,
    title: candidate.title,
    group_id: candidate.groupId,
    url: candidate.url || null,
    score,
    reason: toReferenceReason(matched),
  };
}

function scoreCodeForStep(step = {}, candidate = {}, keywords = []) {
  const pathLower = cleanString(candidate.path).toLowerCase();
  if (!pathLower) return null;

  const commandText = toArray(step.commands).map((item) => cleanString(item.run)).join(' ').toLowerCase();
  let bonus = 0;
  if (commandText && pathLower && commandText.includes(pathLower)) bonus += 3;
  if (commandText && candidate.basename && commandText.includes(String(candidate.basename).toLowerCase())) bonus += 2;

  const score = countKeywordMatches(pathLower, keywords) + bonus;
  if (score <= 0) return null;

  const matched = keywords.filter((kw) => pathLower.includes(kw)).slice(0, 6);
  return {
    source: candidate.source,
    path: candidate.path,
    score,
    reason: toReferenceReason(matched, bonus > 0 ? 'Referenced directly by command template' : ''),
  };
}

function attachReferencesToSteps(steps = [], { knowledgeCandidates = [], codeCandidates = [] } = {}) {
  return steps.map((step) => {
    const searchText = buildStepSearchText(step);
    const keywords = extractKeywords(searchText);

    const knowledge = knowledgeCandidates
      .map((candidate) => scoreKnowledgeForStep(step, candidate, keywords))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const codebase = codeCandidates
      .map((candidate) => scoreCodeForStep(step, candidate, keywords))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    return {
      ...step,
      references: {
        knowledge,
        codebase,
      },
    };
  });
}

function fallbackStepsFromInstruction(instruction = '', project = {}) {
  const text = String(instruction || '').trim();
  const projectName = cleanString(project?.name) || 'project';

  const raw = [
    {
      title: 'Extract objective and constraints from input',
      objective: `Convert rough proposal into a runnable backlog for ${projectName}, preserving constraints and success criteria.`,
      kind: 'setup',
      assumptions: ['Input may contain mixed ideas from chat transcripts and proposal docs.'],
      acceptance: ['A normalized step list with explicit assumptions, targets, and checks exists.'],
      checks: [{ type: 'manual_approve', name: 'scope_review' }],
      commands: [],
      priority: 'high',
    },
    {
      title: 'Build baseline implementation tasks',
      objective: 'Define concrete implementation and experiment tasks with one-step executable scope.',
      kind: 'experiment',
      assumptions: ['Repository has runnable scripts or code entrypoints.'],
      acceptance: ['Each task includes expected outcome and at least one acceptance check.'],
      checks: [{ type: 'manual_approve', name: 'task_quality_gate' }],
      commands: [],
      priority: 'high',
      depends_on: ['step_01'],
    },
    {
      title: 'Attach knowledge and code references per step',
      objective: 'For each step, identify supporting KB documents and relevant code paths to reduce execution bias.',
      kind: 'knowledge',
      assumptions: ['Knowledge groups and/or resource folder may be available.'],
      acceptance: ['Each step has referenced docs/files when available.'],
      checks: [{ type: 'manual_approve', name: 'reference_linkage' }],
      commands: [],
      priority: 'medium',
      depends_on: ['step_02'],
    },
    {
      title: 'Generate orchestration-ready tree modules',
      objective: 'Transform normalized steps into tree nodes with dependency edges and gating metadata.',
      kind: 'analysis',
      assumptions: ['Plan graph can be represented with parent + evidence dependencies.'],
      acceptance: ['Tree modules can be consumed by run-step/run-all orchestrator.'],
      checks: [{ type: 'manual_approve', name: 'tree_module_review' }],
      commands: [],
      priority: 'medium',
      depends_on: ['step_03'],
    },
  ];

  if (/benchmark|ablation|evaluate|experiment|train/i.test(text)) {
    raw.splice(2, 0, {
      title: 'Define benchmark matrix and acceptance metrics',
      objective: 'Specify model/data matrix, thresholds, and reproducible execution settings.',
      kind: 'experiment',
      assumptions: ['Benchmark scripts can be parameterized.'],
      acceptance: ['Metric keys and thresholds are explicit per planned run.'],
      checks: [{ type: 'manual_approve', name: 'benchmark_gate' }],
      commands: [],
      priority: 'high',
      depends_on: ['step_02'],
    });
  }

  return raw
    .map((item, index) => normalizeStep({ ...item, step_id: `step_${String(index + 1).padStart(2, '0')}` }, index))
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

function fallbackOpenRfmStepsFromInstruction(instruction = '', project = {}) {
  const rootPath = cleanString(project?.projectPath) || '<project_root>';
  const raw = [
    {
      title: 'Validate runnable baseline paths in repository',
      objective: 'Confirm openrfm baseline boundaries from existing scripts and model entrypoints before proposing new branches.',
      kind: 'setup',
      assumptions: [
        'The repository already contains executable baseline scripts.',
      ],
      acceptance: [
        'A short baseline capability note is produced with verified script/config paths.',
      ],
      commands: [
        { name: 'inspect_readme', run: `sed -n '1,220p' ${rootPath}/README.md` },
        { name: 'inspect_backbone', run: `sed -n '1,260p' ${rootPath}/models/nn/orig_rt_pl.py` },
      ],
      checks: [{ name: 'baseline_paths_verified', type: 'manual_approve' }],
      priority: 'high',
    },
    {
      title: 'Run DDP smoke baseline and collect artifacts',
      objective: 'Execute smoke pipeline and capture metrics/log artifacts for reproducible baseline evidence.',
      kind: 'experiment',
      assumptions: ['GPU and runtime environment are available for smoke execution.'],
      acceptance: [
        'Smoke run exits successfully and produces metrics/log outputs.',
      ],
      commands: [
        { name: 'run_ddp_smoke', run: `bash ${rootPath}/scripts/run_openrfm_ddp_smoke.sh` },
      ],
      checks: [
        { name: 'smoke_manual_gate', type: 'manual_approve' },
      ],
      depends_on: ['step_01'],
      priority: 'high',
    },
    {
      title: 'Define executable RelBench matrix from current configs',
      objective: 'Build a small real-task matrix using existing relbench configs and data hooks, excluding unsupported synthetic-only claims.',
      kind: 'experiment',
      assumptions: ['RelBench data/task config files are available in repository.'],
      acceptance: [
        'Matrix rows map to existing config files and task definitions.',
      ],
      commands: [],
      checks: [{ name: 'matrix_review', type: 'manual_approve' }],
      depends_on: ['step_02'],
      priority: 'high',
    },
    {
      title: 'Run controlled ablation pass with mode separation',
      objective: 'Execute current ablation script and separate synthetic-mode from real-mode findings in reporting.',
      kind: 'analysis',
      assumptions: ['Current ablation script behavior is explicitly auditable.'],
      acceptance: [
        'Synthetic and real evidence are clearly separated with no mixed claims.',
      ],
      commands: [
        { name: 'run_ablations', run: `bash ${rootPath}/scripts/run_openrfm_ablations.sh` },
      ],
      checks: [{ name: 'ablation_mode_gate', type: 'manual_approve' }],
      depends_on: ['step_03'],
      priority: 'medium',
    },
    {
      title: 'Summarize results and gate future architecture branches',
      objective: 'Produce evidence-backed summary and explicitly gate advanced architecture exploration behind baseline completion.',
      kind: 'milestone',
      assumptions: ['Baseline artifacts and logs are available from prior steps.'],
      acceptance: [
        'A concise decision note exists for what can be promoted next.',
      ],
      commands: [],
      checks: [{ name: 'milestone_approve', type: 'manual_approve' }],
      depends_on: ['step_04'],
      priority: 'medium',
    },
  ];

  return raw
    .map((item, index) => normalizeStep({ ...item, step_id: `step_${String(index + 1).padStart(2, '0')}` }, index))
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

function repairGeneratedSteps(steps = [], { instruction = '', project = null, codeCandidates = [] } = {}) {
  const projectName = cleanString(project?.name).toLowerCase();
  const instructionText = cleanString(instruction).toLowerCase();
  const knownPaths = new Set(toArray(codeCandidates).map((item) => cleanString(item?.path)).filter(Boolean));
  const dropKeywords = ['proj1', 'test/proj1', 'convert_proj1_to_dsl', 'proj1_scaling_study.json'];

  const cleaned = [];
  for (const step of toArray(steps)) {
    if (!step || typeof step !== 'object') continue;
    const title = cleanString(step.title);
    const objective = cleanString(step.objective);
    const stepText = `${title} ${objective}`.toLowerCase();

    const containsForeignProj1 = dropKeywords.some((kw) => stepText.includes(kw))
      && !projectName.includes('proj1')
      && !instructionText.includes('proj1');
    if (containsForeignProj1) continue;

    const commandPaths = toArray(step.commands)
      .map((cmd) => cleanString(cmd?.run))
      .flatMap((run) => extractPathTokens(run));
    const unknownPaths = commandPaths.filter((p) => !knownPaths.has(p));
    const filteredCommands = unknownPaths.length > 0
      ? toArray(step.commands).filter((cmd) => {
        const run = cleanString(cmd?.run);
        if (!run) return false;
        const matches = extractPathTokens(run);
        if (matches.length === 0) return true;
        return matches.every((pathToken) => knownPaths.has(pathToken));
      })
      : toArray(step.commands);

    cleaned.push({
      ...step,
      commands: filteredCommands.slice(0, 8),
    });
  }

  const reindexed = cleaned
    .map((step, index) => normalizeStep({ ...step, step_id: `step_${String(index + 1).padStart(2, '0')}` }, index))
    .filter(Boolean);
  return resolveStepDependencies(reindexed).slice(0, MAX_STEPS);
}

function countOpenRfmFeasibleSteps(steps = []) {
  let feasible = 0;
  let speculative = 0;
  toArray(steps).forEach((step) => {
    const text = [
      cleanString(step?.title),
      cleanString(step?.objective),
      toArray(step?.commands).map((cmd) => cleanString(cmd?.run)).join(' '),
    ].join(' ').toLowerCase();

    if (/\b(dart|kumorfm|chronos-2|gateddeltanet|perceiver bottleneck|architecture\s*[1-5])\b/.test(text)) {
      speculative += 1;
    }
    if (
      /\b(run_openrfm|ddp_smoke|relbench|rfmbench|orig_rt_pl|baseline|smoke|ablation|benchmark|deliverable)\b/.test(text)
    ) {
      feasible += 1;
    }
  });
  return { feasible, speculative };
}

async function generateModelSteps({
  instruction = '',
  project = null,
  codeCandidates = [],
  knowledgeCandidates = [],
} = {}) {
  const goal = cleanString(instruction);
  if (!goal) return [];

  const timeoutRaw = Number(process.env.RESEARCHOPS_TODO_GENERATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const generationTimeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(12000, Math.min(Math.floor(timeoutRaw), 120000))
    : DEFAULT_TIMEOUT_MS;
  const modelTimeoutMs = Math.max(9000, generationTimeoutMs - 7000);

  const projectName = cleanString(project?.name);
  const projectDescription = cleanString(project?.description);
  const projectPath = cleanString(project?.projectPath);
  const safeGoal = sanitizeProposalArtifacts(goal);
  const codeHints = buildPromptHintList(codeCandidates, 18, (item) => item?.path);
  const knowledgeHints = buildPromptHintList(knowledgeCandidates, 12, (item) => item?.title);

  const prompt = [
    'You are a ResearchOps TODO DSL generator.',
    'Convert the user input (rough idea, proposal, or chat transcript) into structured execution steps.',
    'Return ONLY valid JSON with this schema:',
    '{"steps":[{"step_id":"step_01","title":"...","kind":"setup|knowledge|experiment|analysis|milestone|search|patch","objective":"...","assumptions":["..."],"acceptance":["..."],"commands":[{"name":"cmd_01","run":"..."}],"checks":[{"name":"...","type":"manual_approve|file_exists|metric_threshold|unit_tests|regex_in_log|regex_not_in_log|artifact_compare"}],"depends_on":["step_00"],"priority":"high|medium|low"}]}',
    'Rules:',
    '- 4 to 12 steps',
    '- each step must be executable or reviewable in one run/session',
    '- preserve dependency ordering through depends_on',
    '- include assumptions and acceptance criteria for each step',
    '- use concise commands only when strongly implied by input',
    '- if command paths are used, they must come from the provided repository path hints',
    '- avoid placeholders like "do stuff" or "analyze more"',
    '- do not produce unrelated "proj1"/template conversion tasks unless input explicitly requests proj1',
    projectName ? `Project: ${projectName}` : '',
    projectDescription ? `Project description: ${projectDescription}` : '',
    projectPath ? `Project path: ${projectPath}` : '',
    codeHints.length > 0 ? `Repository path hints (allowed): ${codeHints.join(', ')}` : '',
    knowledgeHints.length > 0 ? `Knowledge hints: ${knowledgeHints.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  let modelText = '';
  let codexAvailable = false;
  let geminiAvailable = false;

  try {
    codexAvailable = await codexCliService.isAvailable();
  } catch (_) {
    codexAvailable = false;
  }
  try {
    geminiAvailable = await geminiCliService.isAvailable();
  } catch (_) {
    geminiAvailable = false;
  }

  if (codexAvailable) {
    try {
      const result = await codexCliService.readMarkdown(safeGoal || goal, prompt, { timeout: modelTimeoutMs });
      modelText = cleanString(result?.text);
    } catch (error) {
      console.warn('[ResearchOps] todo DSL generation via codex failed:', error?.message || error);
    }
  }

  if (!modelText && geminiAvailable) {
    try {
      const result = await geminiCliService.readMarkdown(safeGoal || goal, prompt, { timeout: modelTimeoutMs });
      modelText = cleanString(result?.text);
    } catch (error) {
      console.warn('[ResearchOps] todo DSL generation via gemini failed:', error?.message || error);
    }
  }

  if (!modelText) {
    try {
      const result = await Promise.race([
        llmService.generateWithFallback(safeGoal || goal, prompt),
        new Promise((_, reject) => {
          const timer = setTimeout(() => {
            const error = new Error(`TODO DSL generation timed out after ${generationTimeoutMs}ms`);
            error.code = 'TODO_DSL_TIMEOUT';
            reject(error);
          }, generationTimeoutMs);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      modelText = cleanString(result?.text);
    } catch (error) {
      console.warn('[ResearchOps] todo DSL generation via fallback LLM failed:', error?.message || error);
      modelText = '';
    }
  }

  const parsedSteps = parseStepsFromModelOutput(modelText);
  const normalized = parsedSteps
    .map((item, index) => normalizeStep(item, index))
    .filter(Boolean)
    .slice(0, MAX_STEPS);

  return normalized;
}

function buildTodoCandidatesFromSteps(steps = []) {
  return steps
    .map((step, index) => {
      const references = step.references || {};
      const knowledgeCount = toArray(references.knowledge).length;
      const codeCount = toArray(references.codebase).length;
      const refHint = `Refs: ${knowledgeCount} KB, ${codeCount} code.`;
      const targetHint = toArray(step.acceptance).slice(0, 2).join(' ');

      return {
        title: cleanString(step.title).slice(0, 120),
        hypothesis: [cleanString(step.objective), targetHint, refHint].filter(Boolean).join(' '),
        priority: normalizePriority(step.priority, index),
        order: index + 1,
      };
    })
    .filter((item) => item.title && item.hypothesis)
    .slice(0, MAX_STEPS);
}

function buildTreeNodesFromSteps(steps = []) {
  return steps.map((step, index) => {
    const deps = toArray(step.depends_on).map((item) => cleanString(item)).filter(Boolean);
    const parent = deps[0] || '';
    const evidenceDeps = deps.slice(1);

    const checks = toArray(step.checks).length
      ? step.checks
      : [{ name: 'manual_review', type: 'manual_approve' }];

    return {
      id: cleanString(step.step_id) || `step_${String(index + 1).padStart(2, '0')}`,
      parent: parent || undefined,
      title: cleanString(step.title) || `Step ${index + 1}`,
      kind: cleanString(step.kind) || 'experiment',
      assumption: normalizeStringList(step.assumptions),
      target: normalizeStringList(step.acceptance),
      commands: toArray(step.commands),
      checks,
      evidenceDeps,
      tags: ['todo-generator', cleanString(step.priority) || 'medium'].filter(Boolean),
      ui: {
        references: {
          knowledge: toArray(step.references?.knowledge),
          codebase: toArray(step.references?.codebase),
        },
        todo_dsl_step: {
          objective: cleanString(step.objective),
          priority: cleanString(step.priority) || 'medium',
        },
      },
    };
  });
}

async function collectProjectCodeCandidates({ project = null, server = null } = {}) {
  const projectPath = cleanString(project?.projectPath);
  if (!projectPath) return [];

  if (cleanString(project?.locationType).toLowerCase() === 'ssh') {
    return listRemoteProjectFiles(server, projectPath, { maxFiles: 350, maxDepth: 4 });
  }
  return listLocalProjectFiles(projectPath, { maxFiles: 350, maxDepth: 4 });
}

async function generateTodoDslPackage({
  userId,
  instruction = '',
  project = null,
  server = null,
} = {}) {
  const goal = cleanString(instruction);
  if (!goal) {
    const error = new Error('instruction is required');
    error.code = 'TODO_DSL_INVALID';
    throw error;
  }

  const [knowledgeCandidates, codeCandidates] = await Promise.all([
    collectKnowledgeCandidates(userId, project),
    collectProjectCodeCandidates({ project, server }),
  ]);

  let steps = await generateModelSteps({
    instruction: goal,
    project,
    knowledgeCandidates,
    codeCandidates,
  });
  steps = repairGeneratedSteps(steps, {
    instruction: goal,
    project,
    codeCandidates,
  });
  if (isOpenRfmContext(goal, project)) {
    const profile = countOpenRfmFeasibleSteps(steps);
    if (profile.feasible < 3 || profile.speculative > profile.feasible) {
      steps = [];
    }
  }
  if (steps.length === 0) {
    steps = isOpenRfmContext(goal, project)
      ? fallbackOpenRfmStepsFromInstruction(goal, project)
      : fallbackStepsFromInstruction(goal, project);
  }

  steps = resolveStepDependencies(steps)
    .map((step, index) => ({
      ...step,
      step_id: toStepId(step.step_id, index),
    }))
    .slice(0, MAX_STEPS);

  const stepsWithRefs = attachReferencesToSteps(steps, {
    knowledgeCandidates,
    codeCandidates,
  });

  const todoDsl = {
    version: 1,
    type: 'todo_generator_dsl',
    generated_at: new Date().toISOString(),
    input: {
      instruction: goal,
      project_id: cleanString(project?.id) || null,
      project_name: cleanString(project?.name) || null,
      project_path: cleanString(project?.projectPath) || null,
    },
    steps: stepsWithRefs,
  };

  const todoCandidates = buildTodoCandidatesFromSteps(stepsWithRefs);
  const treeNodes = buildTreeNodesFromSteps(stepsWithRefs);

  return {
    todoDsl,
    todoCandidates,
    treeNodes,
    referenceSummary: {
      total_steps: stepsWithRefs.length,
      steps_with_knowledge_refs: stepsWithRefs.filter((step) => toArray(step.references?.knowledge).length > 0).length,
      steps_with_code_refs: stepsWithRefs.filter((step) => toArray(step.references?.codebase).length > 0).length,
      knowledge_candidate_pool: knowledgeCandidates.length,
      code_candidate_pool: codeCandidates.length,
    },
  };
}

module.exports = {
  generateTodoDslPackage,
};
