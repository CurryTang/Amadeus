const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const { runSshCommand, classifySshError } = require('../ssh-auth.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function normalizeNodeId(input = '', fallback = 'baseline_root') {
  const cleaned = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function toInt(value, fallback = 0) {
  const num = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(num) ? num : fallback;
}

function runCommand(command, args = [], { cwd = process.cwd(), timeoutMs = 30000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    proc.stdin.on('error', () => {
      // Ignore EPIPE if child exits early.
    });

    proc.stdin.end(String(input || ''));

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Command timeout after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr, code });
      return reject(new Error(String(stderr || '').trim() || `${command} exited with code ${code}`));
    });
  });
}

function parseLines(value = '') {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function inferAchievements({ files = [], recentSubjects = [], readmeSnippet = '' } = {}) {
  const lowerFiles = files.map((item) => item.toLowerCase());
  const achievements = [];

  if (lowerFiles.some((item) => item.includes('dockerfile') || item.includes('docker-compose'))) {
    achievements.push('Container/runtime setup artifacts exist (Docker related files found).');
  }
  if (lowerFiles.some((item) => item.includes('pixi.toml') || item.includes('requirements.txt') || item.includes('package.json'))) {
    achievements.push('Environment/dependency setup is already bootstrapped.');
  }
  if (lowerFiles.some((item) => /(^|\/)tests?\//.test(item) || item.includes('test'))) {
    achievements.push('Project already contains test assets or validation scripts.');
  }
  if (lowerFiles.some((item) => item.includes('scripts/') && (item.includes('train') || item.includes('run')))) {
    achievements.push('Experiment or pipeline execution scripts are present.');
  }
  if (lowerFiles.some((item) => item.includes('configs/') || /\.ya?ml$/i.test(item) || /\.toml$/i.test(item))) {
    achievements.push('Configurable experiment parameters are structured in config files.');
  }
  if (recentSubjects.length > 0) {
    achievements.push('Recent commit history indicates active engineering progress.');
  }
  if (cleanString(readmeSnippet)) {
    achievements.push('Repository documentation exists and can guide onboarding/runtime assumptions.');
  }

  if (achievements.length === 0) {
    achievements.push('Repository structure is available; baseline state can be used as research root context.');
  }

  return achievements.slice(0, 8);
}

function buildSummary({
  rootPath = '',
  branch = '',
  commit = '',
  commitCount = 0,
  contributors = [],
  recentSubjects = [],
  achievements = [],
} = {}) {
  const contributorLabel = contributors.length > 0
    ? contributors.slice(0, 3).map((item) => item.name || item.id || 'unknown').join(', ')
    : 'unknown';
  const recentLabel = recentSubjects.length > 0
    ? recentSubjects.slice(0, 3).join(' | ')
    : 'no recent commits discovered';

  return [
    `Root path: ${rootPath || '(unknown)'}`,
    `Branch: ${branch || 'HEAD'} · Commit: ${(commit || 'HEAD').slice(0, 12)} · Total commits: ${commitCount}`,
    `Contributors (sample): ${contributorLabel}`,
    `Recent changes: ${recentLabel}`,
    `Achievements: ${achievements.join(' ')}`,
  ].join('\n');
}

function buildRootNode({
  nodeId = 'baseline_root',
  summary = '',
  achievements = [],
  commit = 'HEAD',
  branch = '',
} = {}) {
  const safeNodeId = normalizeNodeId(nodeId, 'baseline_root');
  const assumption = achievements.length > 0
    ? achievements
    : ['Existing codebase contains reusable assets that can seed the research tree.'];

  return {
    id: safeNodeId,
    title: 'Baseline Root: Existing Codebase Achievements',
    kind: 'milestone',
    assumption,
    target: [
      'Baseline status is understood and approved before downstream branching.',
      'Tree root reflects current repository state and commit anchor.',
    ],
    commands: [],
    checks: [
      {
        name: 'baseline_manual_gate',
        type: 'manual_approve',
      },
    ],
    git: {
      base: cleanString(commit) || 'HEAD',
      branch: cleanString(branch) || 'HEAD',
    },
    ui: {
      generatedBy: 'codebase-achievement.service',
      generatedAt: new Date().toISOString(),
      summary,
    },
    tags: ['baseline', 'root', 'auto-generated'],
  };
}

async function collectLocalSnapshot(projectPath = '') {
  const cwd = path.resolve(expandHome(projectPath));
  const safeRoot = cleanString(projectPath) || cwd;

  let branch = 'HEAD';
  let commit = 'HEAD';
  let commitCount = 0;
  let recentSubjects = [];
  let contributors = [];
  let files = [];
  let readmeSnippet = '';

  try {
    const [{ stdout: branchOut }, { stdout: commitOut }, { stdout: countOut }, { stdout: recentOut }, { stdout: contributorOut }] = await Promise.all([
      runCommand('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { timeoutMs: 10000 }),
      runCommand('git', ['-C', cwd, 'rev-parse', 'HEAD'], { timeoutMs: 10000 }),
      runCommand('git', ['-C', cwd, 'rev-list', '--count', 'HEAD'], { timeoutMs: 10000 }),
      runCommand('git', ['-C', cwd, 'log', '--pretty=%s', '-n', '8'], { timeoutMs: 12000 }),
      runCommand('git', ['-C', cwd, 'shortlog', '-sn', '--all'], { timeoutMs: 12000 }),
    ]);

    branch = parseLines(branchOut)[0] || 'HEAD';
    commit = parseLines(commitOut)[0] || 'HEAD';
    commitCount = toInt(parseLines(countOut)[0], 0);
    recentSubjects = parseLines(recentOut).slice(0, 8);
    contributors = parseLines(contributorOut).slice(0, 8).map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      return {
        commits: toInt(match?.[1], 0),
        name: cleanString(match?.[2]) || line,
      };
    });
  } catch (_) {
    // non-git repos are still valid inputs.
  }

  try {
    const { stdout } = await runCommand('find', [cwd, '-maxdepth', '3', '-type', 'f'], { timeoutMs: 20000 });
    files = parseLines(stdout)
      .map((item) => path.relative(cwd, item).replace(/\\/g, '/'))
      .filter(Boolean)
      .slice(0, 4000);
  } catch (_) {
    files = [];
  }

  try {
    const { stdout } = await runCommand('bash', ['-lc', `if [ -f "${cwd}/README.md" ]; then head -n 40 "${cwd}/README.md"; fi`], {
      timeoutMs: 10000,
    });
    readmeSnippet = parseLines(stdout).slice(0, 12).join('\n');
  } catch (_) {
    readmeSnippet = '';
  }

  return {
    rootPath: safeRoot,
    branch,
    commit,
    commitCount,
    recentSubjects,
    contributors,
    files,
    readmeSnippet,
  };
}

async function collectRemoteSnapshot(server, projectPath = '') {
  const rootPath = cleanString(projectPath);
  const script = [
    'set -eu',
    'ROOT="$1"',
    'if [ ! -d "$ROOT" ]; then',
    '  echo "__NOT_DIR__"',
    '  exit 0',
    'fi',
    'echo "__ROOT__:$ROOT"',
    'if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  echo "__BRANCH__:$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"',
    '  echo "__COMMIT__:$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo HEAD)"',
    '  echo "__COMMIT_COUNT__:$(git -C "$ROOT" rev-list --count HEAD 2>/dev/null || echo 0)"',
    '  git -C "$ROOT" log --pretty=%s -n 8 2>/dev/null | sed "s/^/__RECENT__:/"',
    '  git -C "$ROOT" shortlog -sn --all 2>/dev/null | sed "s/^/__CONTRIB__:/"',
    'else',
    '  echo "__BRANCH__:HEAD"',
    '  echo "__COMMIT__:HEAD"',
    '  echo "__COMMIT_COUNT__:0"',
    'fi',
    'find "$ROOT" -maxdepth 3 -type f 2>/dev/null | head -n 4000 | sed "s#^$ROOT/##" | sed "s/^/__FILE__:/"',
    'if [ -f "$ROOT/README.md" ]; then',
    '  head -n 40 "$ROOT/README.md" | sed "s/^/__README__:/"',
    'fi',
  ].join('\n');

  try {
    const { stdout } = await runSshCommand(server, ['bash', '-s', '--', rootPath], {
      timeoutMs: 40000,
      input: `${script}\n`,
    });

    const lines = parseLines(stdout);
    if (lines.includes('__NOT_DIR__')) {
      const error = new Error(`Remote path is not a directory: ${rootPath}`);
      error.code = 'REMOTE_NOT_DIRECTORY';
      throw error;
    }

    const branch = (lines.find((line) => line.startsWith('__BRANCH__:')) || '').slice('__BRANCH__:'.length) || 'HEAD';
    const commit = (lines.find((line) => line.startsWith('__COMMIT__:')) || '').slice('__COMMIT__:'.length) || 'HEAD';
    const commitCount = toInt((lines.find((line) => line.startsWith('__COMMIT_COUNT__:')) || '').slice('__COMMIT_COUNT__:'.length), 0);
    const recentSubjects = lines
      .filter((line) => line.startsWith('__RECENT__:'))
      .map((line) => line.slice('__RECENT__:'.length))
      .filter(Boolean)
      .slice(0, 8);
    const contributors = lines
      .filter((line) => line.startsWith('__CONTRIB__:'))
      .map((line) => line.slice('__CONTRIB__:'.length).trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        return {
          commits: toInt(match?.[1], 0),
          name: cleanString(match?.[2]) || line,
        };
      });
    const files = lines
      .filter((line) => line.startsWith('__FILE__:'))
      .map((line) => line.slice('__FILE__:'.length))
      .filter(Boolean)
      .slice(0, 4000);
    const readmeSnippet = lines
      .filter((line) => line.startsWith('__README__:'))
      .map((line) => line.slice('__README__:'.length))
      .slice(0, 12)
      .join('\n');

    return {
      rootPath,
      branch,
      commit,
      commitCount,
      recentSubjects,
      contributors,
      files,
      readmeSnippet,
    };
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message || String(error?.message || 'SSH snapshot failed'));
    wrapped.code = mapped.code || 'SSH_COMMAND_FAILED';
    throw wrapped;
  }
}

async function summarizeExistingCodebase({ project = {}, server = null } = {}) {
  const projectPath = cleanString(project?.projectPath);
  if (!projectPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  const locationType = cleanString(project?.locationType).toLowerCase();
  const snapshot = locationType === 'ssh'
    ? await collectRemoteSnapshot(server, projectPath)
    : await collectLocalSnapshot(projectPath);

  const achievements = inferAchievements({
    files: snapshot.files,
    recentSubjects: snapshot.recentSubjects,
    readmeSnippet: snapshot.readmeSnippet,
  });

  const summary = buildSummary({
    rootPath: snapshot.rootPath,
    branch: snapshot.branch,
    commit: snapshot.commit,
    commitCount: snapshot.commitCount,
    contributors: snapshot.contributors,
    recentSubjects: snapshot.recentSubjects,
    achievements,
  });

  const rootNode = buildRootNode({
    nodeId: 'baseline_root',
    summary,
    achievements,
    commit: snapshot.commit,
    branch: snapshot.branch,
  });

  return {
    summary,
    achievements,
    snapshot,
    rootNode,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  summarizeExistingCodebase,
};
