const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const GIT_LOG_FIELD_SEPARATOR = '\u001f';
const GIT_LOG_PREFIX = '__COMMIT__:';
const GIT_LOG_FORMAT = `${GIT_LOG_PREFIX}%H%x1f%h%x1f%an%x1f%ae%x1f%ad%x1f%s`;
const IMPORTANT_PROJECT_FILES = new Set([
  'readme',
  'readme.md',
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'pyproject.toml',
  'requirements.txt',
  'poetry.lock',
  'cargo.toml',
  'go.mod',
  'dockerfile',
  'docker-compose.yml',
  '.env',
  '.env.example',
  '.gitignore',
  'makefile',
]);

function normalizeCount(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function clampInteger(raw, fallback, min, max) {
  const parsed = Number.parseInt(String(raw || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function runCommand(command, args = [], { timeoutMs = 15000, input = '', cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: cwd || undefined,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdin.on('error', () => {
      // Ignore EPIPE if process exits before reading stdin.
    });
    child.stdin.end(input);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Command timeout after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr, code });
      return reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function resolveGitLogRange(rootPath, branch) {
  const normalizedBranch = String(branch || '').trim() || 'HEAD';
  if (normalizedBranch === 'HEAD' || normalizedBranch === 'main' || normalizedBranch === 'master') {
    return normalizedBranch;
  }

  // Phase 1: fast path — check standard base refs
  const primaryCandidates = ['origin/main', 'origin/master', 'main', 'master'];
  for (const baseRef of primaryCandidates) {
    if (!baseRef || baseRef === normalizedBranch || `origin/${normalizedBranch}` === baseRef) continue;
    const baseExists = await runCommand('git', ['-C', rootPath, 'rev-parse', '--verify', baseRef], {
      timeoutMs: 8000,
    }).then(() => true).catch(() => false);
    if (!baseExists) continue;
    const mergeBaseResult = await runCommand(
      'git', ['-C', rootPath, 'merge-base', normalizedBranch, baseRef], { timeoutMs: 10000 }
    ).catch(() => ({ stdout: '' }));
    const mergeBase = String(mergeBaseResult.stdout || '').trim();
    if (mergeBase) return `${mergeBase}..${normalizedBranch}`;
  }

  // Phase 2: try all remote-tracking branches, pick the one with the most recent merge-base
  // (handles repos where the "main" branch has a non-standard name like kddbench)
  try {
    const remotesResult = await runCommand(
      'git', ['-C', rootPath, 'branch', '-r', '--format=%(refname:short)'], { timeoutMs: 8000 }
    ).catch(() => ({ stdout: '' }));
    const remotes = String(remotesResult.stdout || '').trim().split(/\r?\n/)
      .map((b) => b.trim())
      .filter((b) => b && !b.includes('HEAD') && b !== normalizedBranch && b !== `origin/${normalizedBranch}`);

    let bestMergeBase = '';
    let bestDate = '';
    for (const baseRef of remotes) {
      const mergeBaseResult = await runCommand(
        'git', ['-C', rootPath, 'merge-base', normalizedBranch, baseRef], { timeoutMs: 8000 }
      ).catch(() => ({ stdout: '' }));
      const mergeBase = String(mergeBaseResult.stdout || '').trim();
      if (!mergeBase) continue;
      const dateResult = await runCommand(
        'git', ['-C', rootPath, 'log', '-1', '--format=%ci', mergeBase], { timeoutMs: 8000 }
      ).catch(() => ({ stdout: '' }));
      const dateStr = String(dateResult.stdout || '').trim();
      if (!bestMergeBase || (dateStr && dateStr > bestDate)) {
        bestMergeBase = mergeBase;
        bestDate = dateStr;
      }
    }
    if (bestMergeBase) return `${bestMergeBase}..${normalizedBranch}`;
  } catch (_) { /* ignore */ }

  return normalizedBranch;
}

class GitLogEntry {
  constructor({
    hash = '',
    shortHash = '',
    authorName = '',
    authorEmail = '',
    authoredAt = '',
    subject = '',
  } = {}) {
    this.hash = String(hash || '');
    this.shortHash = String(shortHash || this.hash.slice(0, 7) || '');
    this.authorName = String(authorName || '');
    this.authorEmail = String(authorEmail || '');
    this.authoredAt = String(authoredAt || '');
    this.subject = String(subject || '');
  }

  static fromEncoded(encodedRecord = '') {
    const fields = String(encodedRecord || '').split(GIT_LOG_FIELD_SEPARATOR);
    if (fields.length < 6) return null;
    return new GitLogEntry({
      hash: fields[0],
      shortHash: fields[1],
      authorName: fields[2],
      authorEmail: fields[3],
      authoredAt: fields[4],
      subject: fields.slice(5).join(GIT_LOG_FIELD_SEPARATOR),
    });
  }

  toJSON() {
    return {
      hash: this.hash,
      shortHash: this.shortHash,
      authorName: this.authorName,
      authorEmail: this.authorEmail,
      authoredAt: this.authoredAt,
      subject: this.subject,
    };
  }
}

function parseGitLogOutput(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(GIT_LOG_PREFIX))
    .map((line) => GitLogEntry.fromEncoded(line.slice(GIT_LOG_PREFIX.length)))
    .filter(Boolean)
    .map((entry) => entry.toJSON());
}

function parseNumstatOutput(output = '') {
  const stats = new Map();
  String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const parts = line.split('\t');
      if (parts.length < 3) return;
      const added = Number.parseInt(parts[0], 10);
      const deleted = Number.parseInt(parts[1], 10);
      const filePath = String(parts.slice(2).join('\t') || '').trim();
      if (!filePath) return;
      stats.set(filePath, {
        added: Number.isFinite(added) ? added : 0,
        deleted: Number.isFinite(deleted) ? deleted : 0,
      });
    });
  return stats;
}

function parseGitStatusPorcelain(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\r/g, ''))
    .filter((line) => line.length >= 4)
    .map((line) => {
      const x = line[0] || ' ';
      const y = line[1] || ' ';
      const rawPath = line.slice(3).trim();
      const pathPart = rawPath.includes(' -> ')
        ? rawPath.split(' -> ').pop()
        : rawPath;
      const statusPair = `${x}${y}`;
      let status = 'modified';
      if (statusPair.includes('A')) status = 'added';
      if (statusPair.includes('D')) status = 'deleted';
      if (statusPair.includes('R')) status = 'renamed';
      if (statusPair.includes('??')) status = 'untracked';
      return {
        path: pathPart,
        status,
      };
    })
    .filter((item) => item.path);
}

function buildProjectFileSummary({
  rootPath = '',
  entries = [],
  counts = {},
  sampleLimit = 40,
} = {}) {
  const sorted = entries
    .map((entry) => ({
      name: String(entry?.name || ''),
      kind: String(entry?.kind || 'other'),
    }))
    .filter((entry) => entry.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const cappedLimit = Math.max(Number.parseInt(sampleLimit, 10) || 40, 1);
  const sampledEntries = sorted.slice(0, cappedLimit);

  const directories = [];
  const files = [];
  const hidden = [];

  sampledEntries.forEach((entry) => {
    const isHidden = entry.kind === 'hidden' || entry.name.startsWith('.');
    if (isHidden) {
      hidden.push(entry.name);
      return;
    }
    if (entry.kind === 'directory') {
      directories.push(entry.name);
      return;
    }
    if (entry.kind === 'file') {
      files.push(entry.name);
    }
  });

  const importantFiles = files
    .filter((name) => IMPORTANT_PROJECT_FILES.has(name.toLowerCase()))
    .slice(0, 12);

  const totalCount = normalizeCount(counts.total, sorted.length);
  const directoryCount = normalizeCount(counts.directories, directories.length);
  const fileCount = normalizeCount(counts.files, files.length);
  const hiddenCount = normalizeCount(counts.hidden, hidden.length);

  return {
    rootPath,
    sampleLimit: cappedLimit,
    truncated: totalCount > sampledEntries.length,
    counts: {
      total: totalCount,
      directories: directoryCount,
      files: fileCount,
      hidden: hiddenCount,
      others: Math.max(totalCount - directoryCount - fileCount - hiddenCount, 0),
    },
    directories: directories.slice(0, 20),
    files: files.slice(0, 24),
    hidden: hidden.slice(0, 12),
    importantFiles,
  };
}

async function checkLocalProjectPath(projectPath) {
  const targetPath = String(projectPath || '').trim();
  if (!targetPath) throw new Error('projectPath is required');

  const normalizedPath = path.resolve(expandHome(targetPath));
  try {
    const stats = await fs.stat(normalizedPath);
    return {
      exists: true,
      isDirectory: stats.isDirectory(),
      normalizedPath,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { exists: false, isDirectory: false, normalizedPath };
    }
    throw error;
  }
}

async function ensureLocalProjectPath(projectPath) {
  const targetPath = String(projectPath || '').trim();
  if (!targetPath) throw new Error('projectPath is required');

  const normalizedPath = path.resolve(expandHome(targetPath));
  await fs.mkdir(normalizedPath, { recursive: true });
  const stats = await fs.stat(normalizedPath);
  if (!stats.isDirectory()) {
    throw new Error('Project path exists but is not a directory');
  }
  return { normalizedPath };
}

async function loadLocalProjectGitProgress(projectPath, limit = 25) {
  const targetPath = String(projectPath || '').trim();
  if (!targetPath) throw new Error('projectPath is required');

  const rootPath = path.resolve(expandHome(targetPath));
  const safeLimit = clampInteger(limit, 25, 1, 120);

  let isGitRepo = false;
  try {
    const check = await runCommand('git', ['-C', rootPath, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 10000,
    });
    isGitRepo = String(check.stdout || '').trim() === 'true';
  } catch {
    isGitRepo = false;
  }

  if (!isGitRepo) {
    return {
      rootPath,
      isGitRepo: false,
      branch: null,
      totalCommits: 0,
      commits: [],
    };
  }

  const branchResult = await runCommand('git', ['-C', rootPath, 'branch', '--show-current'], {
    timeoutMs: 10000,
  }).catch(() => ({ stdout: '' }));
  const branch = String(branchResult.stdout || '').trim() || 'HEAD';
  const logRange = await resolveGitLogRange(rootPath, branch);

  const totalResult = await runCommand('git', ['-C', rootPath, 'rev-list', '--count', logRange], {
    timeoutMs: 10000,
  }).catch(() => ({ stdout: '0' }));

  const logResult = await runCommand('git', [
    '-C', rootPath,
    'log',
    logRange,
    '--first-parent',
    '--date=iso-strict',
    `--pretty=format:${GIT_LOG_FORMAT}`,
    '-n',
    String(safeLimit),
  ], { timeoutMs: 18000 });

  const commits = parseGitLogOutput(logResult.stdout);
  return {
    rootPath,
    isGitRepo: true,
    branch,
    totalCommits: normalizeCount(totalResult.stdout, commits.length),
    commits,
  };
}

async function loadLocalProjectFiles(projectPath, sampleLimit = 40) {
  const targetPath = String(projectPath || '').trim();
  if (!targetPath) throw new Error('projectPath is required');

  const rootPath = path.resolve(expandHome(targetPath));
  const dirents = await fs.readdir(rootPath, { withFileTypes: true });

  let directoryCount = 0;
  let fileCount = 0;
  let hiddenCount = 0;
  const entries = dirents.map((dirent) => {
    let kind = 'other';
    if (dirent.name.startsWith('.')) {
      kind = 'hidden';
      hiddenCount += 1;
    } else if (dirent.isDirectory()) {
      kind = 'directory';
      directoryCount += 1;
    } else if (dirent.isFile()) {
      kind = 'file';
      fileCount += 1;
    }
    return { name: dirent.name, kind };
  });

  return buildProjectFileSummary({
    rootPath,
    entries,
    counts: {
      total: entries.length,
      directories: directoryCount,
      files: fileCount,
      hidden: hiddenCount,
    },
    sampleLimit: clampInteger(sampleLimit, 40, 1, 120),
  });
}

async function loadLocalProjectChangedFiles(projectPath, limit = 200) {
  const targetPath = String(projectPath || '').trim();
  if (!targetPath) throw new Error('projectPath is required');
  const rootPath = path.resolve(expandHome(targetPath));
  const safeLimit = clampInteger(limit, 200, 1, 1000);

  let isGitRepo = false;
  try {
    const check = await runCommand('git', ['-C', rootPath, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 10000,
    });
    isGitRepo = String(check.stdout || '').trim() === 'true';
  } catch {
    isGitRepo = false;
  }
  if (!isGitRepo) {
    return { rootPath, isGitRepo: false, items: [] };
  }

  const [statusResult, numstatResult] = await Promise.all([
    runCommand('git', ['-C', rootPath, 'status', '--porcelain'], { timeoutMs: 15000 }),
    runCommand('git', ['-C', rootPath, 'diff', '--numstat'], { timeoutMs: 15000 }).catch(() => ({ stdout: '' })),
  ]);
  const statusItems = parseGitStatusPorcelain(statusResult.stdout);
  const numstatMap = parseNumstatOutput(numstatResult.stdout);
  const items = statusItems
    .slice(0, safeLimit)
    .map((item) => {
      const stat = numstatMap.get(item.path) || { added: 0, deleted: 0 };
      return {
        path: item.path,
        status: item.status,
        added: stat.added,
        deleted: stat.deleted,
      };
    });

  return {
    rootPath,
    isGitRepo: true,
    items,
  };
}

module.exports = {
  checkLocalProjectPath,
  ensureLocalProjectPath,
  loadLocalProjectGitProgress,
  loadLocalProjectFiles,
  loadLocalProjectChangedFiles,
};
