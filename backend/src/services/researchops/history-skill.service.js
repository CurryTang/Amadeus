const fs = require('fs/promises');
const path = require('path');
const store = require('./store');

const SKILLS_ROOT_DIR = path.join(__dirname, '..', '..', '..', '..', 'skills');
const MAX_EVENT_SCAN = 1200;
const MAX_ARTIFACT_SCAN = 400;
const MAX_PATHS_IN_SKILL = 40;
const MAX_TRACKED_PATHS = 800;
const MAX_PROCESSED_RUN_IDS = 800;
const MAX_TEXT_SCAN_LENGTH = 120000;

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toSlug(value = '') {
  return cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'project';
}

function normalizePathCandidate(raw = '') {
  let token = String(raw || '').trim();
  if (!token) return '';
  token = token
    .replace(/^[`"'([{<]+/, '')
    .replace(/[`"')\]}>.,;:!?]+$/, '')
    .replace(/\\/g, '/')
    .trim();

  if (!token) return '';
  if (/^[a-z]+:\/\//i.test(token)) return '';
  if (token.startsWith('mailto:')) return '';
  if (token.startsWith('$')) return '';
  if (token.includes('${')) return '';
  if (token.includes('*')) return '';
  if (token.length > 300) return '';
  if (!token.includes('/')) return '';
  if (['/', '.', '..'].includes(token)) return '';

  if (token.startsWith('/tmp/researchops-runs/')) return '';
  if (token.startsWith('/private/tmp/researchops-runs/')) return '';
  if (token.startsWith('/var/folders/')) return '';
  if (token.startsWith('tmp/researchops-runs/')) return '';

  token = token.replace(/\/{2,}/g, '/');
  if (token.endsWith('/')) token = token.slice(0, -1);
  return token;
}

function addPathCount(map, rawPath, weight = 1) {
  const pathValue = normalizePathCandidate(rawPath);
  if (!pathValue) return;
  const current = Number(map.get(pathValue) || 0);
  map.set(pathValue, current + Math.max(1, Number(weight) || 1));
}

function extractPathsFromText(text = '', map, weight = 1) {
  const raw = String(text || '').trim();
  if (!raw) return;
  const sample = raw.slice(-MAX_TEXT_SCAN_LENGTH);
  const patterns = [
    /(?:^|[\s`"'([{<])((?:~|\.{1,2}|\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._@-]+)+\/?)/g,
    /(?:^|[\s`"'([{<])([A-Za-z]:\\(?:[^\\\s"'`<>|]+\\?)+)/g,
  ];

  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(sample);
    while (match) {
      addPathCount(map, match[1], weight);
      match = pattern.exec(sample);
    }
  }
}

function collectPathsFromArtifact(artifact, map) {
  if (!artifact || typeof artifact !== 'object') return;
  addPathCount(map, artifact.path, 2);
  const metadata = artifact.metadata && typeof artifact.metadata === 'object'
    ? artifact.metadata
    : {};
  const metadataPathKeys = [
    'path',
    'localPath',
    'filePath',
    'sourcePath',
    'targetPath',
    'relativePath',
    'cwd',
    'repoPath',
    'referencePath',
  ];
  for (const key of metadataPathKeys) {
    const value = metadata[key];
    if (typeof value === 'string') {
      addPathCount(map, value, 2);
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) addPathCount(map, item, 1);
    }
  }
}

function collectPathsFromStep(step, map) {
  if (!step || typeof step !== 'object') return;
  const outputs = step.outputs && typeof step.outputs === 'object' ? step.outputs : {};
  const metrics = step.metrics && typeof step.metrics === 'object' ? step.metrics : {};

  extractPathsFromText(outputs.prompt, map, 1);
  extractPathsFromText(outputs.stdoutTail, map, 1);
  extractPathsFromText(outputs.stderrTail, map, 1);
  extractPathsFromText(outputs.summary, map, 1);
  extractPathsFromText(step.message, map, 1);
  extractPathsFromText(metrics.effectiveCwd, map, 1);
  extractPathsFromText(metrics.requestedCwd, map, 1);
}

function collectPathsFromEvent(event, map) {
  if (!event || typeof event !== 'object') return;
  extractPathsFromText(event.message, map, 1);
  if (event.payload && typeof event.payload === 'object') {
    try {
      extractPathsFromText(JSON.stringify(event.payload), map, 1);
    } catch (_) {
      // Ignore circular payload values.
    }
  }
}

function sortedCountEntries(pathCounts = {}) {
  return Object.entries(pathCounts)
    .filter(([key, value]) => !!key && Number(value) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
}

function buildSkillMarkdown({
  skillTitle,
  projectId,
  updatedAt,
  processedRuns,
  pathEntries,
  indexPath,
}) {
  const lines = [
    `# ${skillTitle}`,
    '',
    'Auto-generated reusable skill synthesized from successful AGENT run history.',
    '',
    '## Scope',
    `- Project ID: \`${projectId}\``,
    `- Updated At: \`${updatedAt}\``,
    `- Processed AGENT Runs: \`${processedRuns}\``,
    '',
    '## High-Signal Paths',
    'Prioritize these paths when starting implementation or debugging:',
  ];

  if (pathEntries.length === 0) {
    lines.push('- No stable file paths detected yet.');
  } else {
    for (const [filePath, count] of pathEntries) {
      lines.push(`- \`${filePath}\` (observed ${count}x)`);
    }
  }

  lines.push(
    '',
    '## Reuse Guide',
    '- Read top paths first to match existing architecture and conventions.',
    '- Prefer extending nearby modules rather than creating parallel implementations.',
    '- Validate behavior against tests/scripts close to these paths.',
    '',
    '## Source',
    `- Auto-generated index: \`${indexPath}\``,
    ''
  );

  return `${lines.join('\n')}\n`;
}

async function readIndexFile(indexPath) {
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function synthesizeHistorySkill({ userId, run }) {
  const uid = cleanString(userId || 'czk').toLowerCase() || 'czk';
  const runId = cleanString(run?.id);
  const projectId = cleanString(run?.projectId);
  const runType = cleanString(run?.runType).toUpperCase();
  if (!runId || !projectId || runType !== 'AGENT') {
    return { updated: false, reason: 'not_applicable' };
  }

  const [eventsResult, artifacts, steps, project] = await Promise.all([
    store.listRunEvents(uid, runId, { afterSequence: -1, limit: MAX_EVENT_SCAN }).catch(() => ({ items: [] })),
    store.listRunArtifacts(uid, runId, { limit: MAX_ARTIFACT_SCAN }).catch(() => []),
    store.listRunSteps(uid, runId).catch(() => []),
    store.getProject(uid, projectId).catch(() => null),
  ]);

  const pathMap = new Map();
  for (const event of (Array.isArray(eventsResult?.items) ? eventsResult.items : [])) {
    collectPathsFromEvent(event, pathMap);
  }
  for (const artifact of (Array.isArray(artifacts) ? artifacts : [])) {
    collectPathsFromArtifact(artifact, pathMap);
  }
  for (const step of (Array.isArray(steps) ? steps : [])) {
    collectPathsFromStep(step, pathMap);
  }

  if (pathMap.size === 0) {
    return { updated: false, reason: 'no_paths' };
  }

  const projectSlug = toSlug(projectId);
  const skillDirName = `auto-history-${projectSlug}`;
  const skillDir = path.join(SKILLS_ROOT_DIR, skillDirName);
  const skillMdPath = path.join(skillDir, 'SKILL.md');
  const indexPath = path.join(skillDir, 'history-index.json');

  const previousIndex = await readIndexFile(indexPath);
  const previousRunIds = Array.isArray(previousIndex.processedRunIds)
    ? previousIndex.processedRunIds.map((item) => cleanString(item)).filter(Boolean)
    : [];
  if (previousRunIds.includes(runId)) {
    return {
      updated: false,
      reason: 'already_processed',
      skillDir,
      skillMdPath,
      processedRuns: previousRunIds.length,
    };
  }

  const mergedCounts = previousIndex.pathCounts && typeof previousIndex.pathCounts === 'object'
    ? { ...previousIndex.pathCounts }
    : {};
  for (const [filePath, count] of pathMap.entries()) {
    const current = Number(mergedCounts[filePath] || 0);
    mergedCounts[filePath] = current + Number(count || 0);
  }

  const prunedEntries = sortedCountEntries(mergedCounts).slice(0, MAX_TRACKED_PATHS);
  const nextCounts = Object.fromEntries(prunedEntries);
  const nextRunIds = [runId, ...previousRunIds].slice(0, MAX_PROCESSED_RUN_IDS);
  const updatedAt = new Date().toISOString();
  const pathEntries = prunedEntries.slice(0, MAX_PATHS_IN_SKILL);
  const skillTitle = `auto-history-${projectSlug}`;

  const indexDoc = {
    schemaVersion: '1.0',
    generatedBy: 'researchops-history-skill',
    projectId,
    projectName: cleanString(project?.name) || null,
    updatedAt,
    processedRunIds: nextRunIds,
    pathCounts: nextCounts,
    lastRun: {
      id: runId,
      at: updatedAt,
    },
  };
  const skillMd = buildSkillMarkdown({
    skillTitle,
    projectId,
    updatedAt,
    processedRuns: nextRunIds.length,
    pathEntries,
    indexPath: path.relative(SKILLS_ROOT_DIR, indexPath).split(path.sep).join('/'),
  });

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(indexDoc, null, 2)}\n`, 'utf8');
  await fs.writeFile(skillMdPath, skillMd, 'utf8');

  return {
    updated: true,
    reason: 'ok',
    skillDir,
    skillMdPath,
    indexPath,
    projectId,
    processedRuns: nextRunIds.length,
    extractedPathCount: pathMap.size,
    topPathCount: pathEntries.length,
    skillName: skillTitle,
  };
}

module.exports = {
  synthesizeHistorySkill,
};
