const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');
const s3Service = require('../services/s3.service');
const researchOpsStore = require('../services/researchops/store');
const researchOpsRunner = require('../services/researchops/runner');
const knowledgeGroupsService = require('../services/knowledge-groups.service');
const knowledgeAssetsService = require('../services/researchops/knowledge-assets.service');
const contextPackService = require('../services/researchops/context-pack.service');
const projectInsightsProxy = require('../services/project-insights-proxy.service');
const projectInsightsService = require('../services/project-insights.service');
const workflowSchemaService = require('../services/researchops/workflow-schema.service');
const planAgentService = require('../services/researchops/plan-agent.service');

const knowledgeAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024,
  },
});

function parseLimit(raw, fallback = 50, max = 300) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function parseOffset(raw, fallback = 0, max = 100000) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 0), max);
}

function getUserId(req) {
  return req.userId || 'czk';
}

function sanitizeError(error, fallback) {
  return error?.message || fallback;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMaybeJson(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function buildRemotePathResolverScript(actionCommand) {
  return [
    'raw="$1"',
    'if [ -z "$raw" ]; then echo "__INVALID_PATH__"; exit 0; fi',
    'case "$raw" in',
    '  "~") target="$HOME" ;;',
    '  "~/"*) target="$HOME/${raw#~/}" ;;',
    '  *) target="$raw" ;;',
    'esac',
    actionCommand,
  ].join('\n');
}

async function withTimeout(promiseFactory, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await promiseFactory(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function runCommand(command, args = [], { timeoutMs = 15000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
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
      // Ignore EPIPE if remote process exits before reading stdin.
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
const PAPER_RESOURCE_EXTENSIONS = new Set([
  '.pdf', '.md', '.markdown', '.txt', '.bib', '.tex', '.json', '.csv',
]);
const TEXT_FILE_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini',
  '.env', '.js', '.jsx', '.ts', '.tsx', '.py', '.sh', '.bash', '.zsh',
  '.java', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.sql', '.xml',
  '.html', '.css', '.scss', '.sass', '.dockerfile', '.gitignore', '.conf',
  '.cfg', '.log', '.csv',
]);
const KB_SYNC_JOBS = new Map();
const KB_SYNC_JOB_TTL_MS = 6 * 60 * 60 * 1000;

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
      if (statusPair === '??') status = 'untracked';
      return {
        path: pathPart,
        status,
      };
    })
    .filter((item) => item.path);
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

function normalizeCount(value, fallback = 0) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractGpuCapacity(capacityInput = {}) {
  const capacity = asObject(capacityInput);
  const gpu = asObject(capacity.gpu);
  const gpus = Array.isArray(capacity.gpus) ? capacity.gpus : [];
  const total = normalizeCount(
    gpu.count ?? gpu.total ?? capacity.gpuCount ?? capacity.gpu_total,
    gpus.length
  );
  const availableExplicit = gpu.available ?? gpu.free ?? capacity.gpuAvailable ?? capacity.gpu_available;
  const available = availableExplicit !== undefined
    ? normalizeCount(availableExplicit, Math.max(total, 0))
    : Math.max(total - gpus.filter((entry) => String(entry?.running_node || entry?.runningNode || '').trim()).length, 0);
  return { total, available };
}

function extractCpuMemoryCapacity(capacityInput = {}) {
  const capacity = asObject(capacityInput);
  const cpu = asObject(capacity.cpu);
  const total = toNumber(
    cpu.memory_gb
    ?? cpu.memoryGb
    ?? cpu.memory_total_gb
    ?? capacity.memory_gb
    ?? capacity.memoryGb,
    0
  );
  const available = toNumber(
    cpu.memory_available_gb
    ?? cpu.memoryAvailableGb
    ?? capacity.memory_available_gb
    ?? capacity.memoryAvailableGb,
    Math.max(total, 0)
  );
  return { total, available };
}

function deriveDaemonStatus(daemon, { staleAfterMs = 90 * 1000 } = {}) {
  const rawStatus = String(daemon?.status || '').trim().toUpperCase();
  const heartbeatAt = String(daemon?.heartbeatAt || '').trim();
  const heartbeatMs = heartbeatAt ? Date.parse(heartbeatAt) : NaN;
  const stale = !Number.isFinite(heartbeatMs) || (Date.now() - heartbeatMs > staleAfterMs);
  if (rawStatus === 'DRAINING') return 'DRAINING';
  if (rawStatus === 'OFFLINE') return 'OFFLINE';
  return stale ? 'OFFLINE' : 'ONLINE';
}

function parseProviderConcurrencyLimits() {
  const defaultsRaw = Number(process.env.RESEARCHOPS_MAX_CONCURRENT_AGENTS || 3);
  const defaultLimit = Number.isFinite(defaultsRaw) && defaultsRaw > 0 ? Math.floor(defaultsRaw) : 3;
  const parsed = {};
  const source = String(process.env.RESEARCHOPS_AGENT_LIMITS || '').trim();
  if (source) {
    try {
      const json = JSON.parse(source);
      if (json && typeof json === 'object') {
        Object.entries(json).forEach(([provider, value]) => {
          const n = Number(value);
          if (Number.isFinite(n) && n > 0) parsed[String(provider)] = Math.floor(n);
        });
      }
    } catch (_) {
      // Ignore malformed env and keep defaults.
    }
  }
  return { defaultLimit, parsed };
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
  const others = [];

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
      return;
    }
    others.push(entry.name);
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

function buildSshArgs(server, { connectTimeout = 12 } = {}) {
  const keyPath = expandHome(server.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server.port || 22),
  ];
  if (String(server.proxy_jump || '').trim()) {
    args.push('-J', String(server.proxy_jump).trim());
  }
  return args;
}

async function getSshServerById(serverId) {
  const sid = String(serverId || '').trim();
  if (!sid) return null;
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE id = ?`,
    args: [sid],
  });
  return result.rows?.[0] || null;
}

async function resolveProjectContext(userId, projectId) {
  const project = await researchOpsStore.getProject(userId, projectId);
  if (!project) {
    const error = new Error('Project not found');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }
  if (!project.projectPath && !project.kbFolderPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  if (project.locationType === 'ssh') {
    const server = await getSshServerById(project.serverId);
    if (!server) {
      const error = new Error(`SSH server ${project.serverId} not found`);
      error.code = 'SSH_SERVER_NOT_FOUND';
      throw error;
    }
    return { project, server };
  }

  return { project, server: null };
}

async function loadLocalProjectGitProgress(projectPath, limit) {
  return projectInsightsService.loadLocalProjectGitProgress(projectPath, limit);
}

async function loadSshProjectGitProgress(server, projectPath, limit) {
  const target = String(projectPath || '').trim();
  const args = buildSshArgs(server, { connectTimeout: 15 });
  const script = buildRemotePathResolverScript([
    'limit="$2"',
    'if ! printf "%s" "$limit" | grep -Eq "^[0-9]+$"; then limit=25; fi',
    'if [ "$limit" -lt 1 ]; then limit=1; fi',
    'if [ "$limit" -gt 120 ]; then limit=120; fi',
    'if [ ! -d "$target" ]; then echo "__NOT_DIR__:$target"; exit 0; fi',
    'echo "__ROOT__:$target"',
    'if ! git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "__NOT_GIT__"; exit 0; fi',
    'branch="$(git -C "$target" branch --show-current 2>/dev/null)"',
    'if [ -z "$branch" ]; then branch="HEAD"; fi',
    'echo "__BRANCH__:$branch"',
    'log_range="$branch"',
    'if [ "$branch" != "HEAD" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ]; then',
    '  for base_ref in origin/main origin/master main master; do',
    '    [ "$base_ref" = "$branch" ] && continue',
    '    if git -C "$target" rev-parse --verify "$base_ref" >/dev/null 2>&1; then',
    '      merge_base="$(git -C "$target" merge-base "$branch" "$base_ref" 2>/dev/null || true)"',
    '      if [ -n "$merge_base" ]; then',
    '        log_range="$merge_base..$branch"',
    '        break',
    '      fi',
    '    fi',
    '  done',
    '  if [ "$log_range" = "$branch" ]; then',
    '    best_mb="" best_date=""',
    '    for base_ref in $(git -C "$target" branch -r --format="%(refname:short)" 2>/dev/null); do',
    '      case "$base_ref" in *HEAD*) continue ;; esac',
    '      [ "$base_ref" = "$branch" ] && continue',
    '      [ "$base_ref" = "origin/$branch" ] && continue',
    '      git -C "$target" rev-parse --verify "$base_ref" >/dev/null 2>&1 || continue',
    '      mb="$(git -C "$target" merge-base "$branch" "$base_ref" 2>/dev/null || true)"',
    '      [ -z "$mb" ] && continue',
    '      d="$(git -C "$target" log -1 --format="%ci" "$mb" 2>/dev/null || true)"',
    '      if [ -z "$best_mb" ] || [ "$d" \\> "$best_date" ]; then best_mb="$mb"; best_date="$d"; fi',
    '    done',
    '    [ -n "$best_mb" ] && log_range="$best_mb..$branch"',
    '  fi',
    'fi',
    'total="$(git -C "$target" rev-list --count "$log_range" 2>/dev/null || echo 0)"',
    'echo "__TOTAL__:$total"',
    `git -C "$target" log "$log_range" --first-parent --date=iso-strict --pretty=format:'${GIT_LOG_FORMAT}' -n "$limit"`,
  ].join('\n'));

  args.push(`${server.user}@${server.host}`, 'bash', '-s', '--', target, String(limit));
  const { stdout } = await runCommand('ssh', args, { timeoutMs: 26000, input: `${script}\n` });
  const lines = String(stdout || '').split(/\r?\n/);
  const rootPathLine = lines.find((line) => line.startsWith('__ROOT__:')) || '';
  const rootPath = rootPathLine ? rootPathLine.slice('__ROOT__:'.length) : target;
  if (lines.some((line) => line.startsWith('__NOT_DIR__:'))) {
    throw new Error(`Remote project path is not a directory: ${rootPath}`);
  }

  if (lines.some((line) => line.trim() === '__NOT_GIT__')) {
    return {
      rootPath,
      isGitRepo: false,
      branch: null,
      totalCommits: 0,
      commits: [],
    };
  }

  const branchLine = lines.find((line) => line.startsWith('__BRANCH__:')) || '';
  const totalLine = lines.find((line) => line.startsWith('__TOTAL__:')) || '';
  const commits = parseGitLogOutput(stdout);
  return {
    rootPath,
    isGitRepo: true,
    branch: branchLine.slice('__BRANCH__:'.length).trim() || 'HEAD',
    totalCommits: normalizeCount(totalLine.slice('__TOTAL__:'.length), commits.length),
    commits,
  };
}

async function loadProjectGitProgress(project, server, limit) {
  if (project.locationType === 'ssh') {
    return loadSshProjectGitProgress(server, project.projectPath, limit);
  }
  return loadLocalProjectGitProgress(project.projectPath, limit);
}

async function loadLocalProjectFiles(projectPath, sampleLimit) {
  return projectInsightsService.loadLocalProjectFiles(projectPath, sampleLimit);
}

async function loadLocalProjectChangedFiles(projectPath, limit) {
  return projectInsightsService.loadLocalProjectChangedFiles(projectPath, limit);
}

async function loadSshProjectFiles(server, projectPath, sampleLimit) {
  const target = String(projectPath || '').trim();
  const args = buildSshArgs(server, { connectTimeout: 15 });
  const script = buildRemotePathResolverScript([
    'limit="$2"',
    'if ! printf "%s" "$limit" | grep -Eq "^[0-9]+$"; then limit=40; fi',
    'if [ "$limit" -lt 1 ]; then limit=1; fi',
    'if [ "$limit" -gt 120 ]; then limit=120; fi',
    'if [ ! -d "$target" ]; then echo "__NOT_DIR__:$target"; exit 0; fi',
    'echo "__ROOT__:$target"',
    'total="$(find "$target" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d \' \')"',
    'dirs="$(find "$target" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d \' \')"',
    'files="$(find "$target" -mindepth 1 -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d \' \')"',
    'hidden="$(find "$target" -mindepth 1 -maxdepth 1 -name \'.*\' 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "__COUNTS__:$total:$dirs:$files:$hidden"',
    'shown=0',
    'for item in "$target"/* "$target"/.[!.]* "$target"/..?*; do',
    '  [ -e "$item" ] || continue',
    '  name="$(basename "$item")"',
    '  [ "$name" = "." ] && continue',
    '  [ "$name" = ".." ] && continue',
    '  if [ "${name#\\.}" != "$name" ]; then kind="hidden";',
    '  elif [ -d "$item" ]; then kind="directory";',
    '  elif [ -f "$item" ]; then kind="file";',
    '  else kind="other"; fi',
    '  printf "__ENTRY__:%s\\037%s\\n" "$kind" "$name"',
    '  shown=$((shown + 1))',
    '  if [ "$shown" -ge "$limit" ]; then break; fi',
    'done',
  ].join('\n'));

  args.push(`${server.user}@${server.host}`, 'bash', '-s', '--', target, String(sampleLimit));
  const { stdout } = await runCommand('ssh', args, { timeoutMs: 26000, input: `${script}\n` });
  const lines = String(stdout || '').split(/\r?\n/);
  const rootPathLine = lines.find((line) => line.startsWith('__ROOT__:')) || '';
  const rootPath = rootPathLine ? rootPathLine.slice('__ROOT__:'.length) : target;
  if (lines.some((line) => line.startsWith('__NOT_DIR__:'))) {
    throw new Error(`Remote project path is not a directory: ${rootPath}`);
  }

  const countsLine = lines.find((line) => line.startsWith('__COUNTS__:')) || '';
  const countParts = countsLine.replace('__COUNTS__:', '').split(':');
  const counts = {
    total: normalizeCount(countParts[0], 0),
    directories: normalizeCount(countParts[1], 0),
    files: normalizeCount(countParts[2], 0),
    hidden: normalizeCount(countParts[3], 0),
  };

  const entries = lines
    .filter((line) => line.startsWith('__ENTRY__:'))
    .map((line) => line.slice('__ENTRY__:'.length))
    .map((encoded) => {
      const [kind = 'other', name = ''] = encoded.split('\u001f');
      return { kind, name };
    })
    .filter((entry) => entry.name);

  return buildProjectFileSummary({
    rootPath,
    entries,
    counts,
    sampleLimit,
  });
}

async function loadProjectFiles(project, server, sampleLimit) {
  if (project.locationType === 'ssh') {
    return loadSshProjectFiles(server, project.projectPath, sampleLimit);
  }
  return loadLocalProjectFiles(project.projectPath, sampleLimit);
}

async function loadSshProjectChangedFiles(server, projectPath, limit) {
  const target = String(projectPath || '').trim();
  const args = buildSshArgs(server, { connectTimeout: 15 });
  const script = buildRemotePathResolverScript([
    'limit="$2"',
    'if ! printf "%s" "$limit" | grep -Eq "^[0-9]+$"; then limit=200; fi',
    'if [ "$limit" -lt 1 ]; then limit=1; fi',
    'if [ "$limit" -gt 1000 ]; then limit=1000; fi',
    'if [ ! -d "$target" ]; then echo "__NOT_DIR__:$target"; exit 0; fi',
    'echo "__ROOT__:$target"',
    'if ! git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "__NOT_GIT__"; exit 0; fi',
    'echo "__STATUS_BEGIN__"',
    'git -C "$target" status --porcelain',
    'echo "__STATUS_END__"',
    'echo "__NUMSTAT_BEGIN__"',
    'git -C "$target" diff --numstat',
    'echo "__NUMSTAT_END__"',
  ].join('\n'));

  args.push(`${server.user}@${server.host}`, 'bash', '-s', '--', target, String(limit));
  const { stdout } = await runCommand('ssh', args, { timeoutMs: 30000, input: `${script}\n` });
  const lines = String(stdout || '').split(/\r?\n/);
  const rootPathLine = lines.find((line) => line.startsWith('__ROOT__:')) || '';
  const rootPath = rootPathLine ? rootPathLine.slice('__ROOT__:'.length) : target;
  if (lines.some((line) => line.startsWith('__NOT_DIR__:'))) {
    throw new Error(`Remote project path is not a directory: ${rootPath}`);
  }
  if (lines.some((line) => line.trim() === '__NOT_GIT__')) {
    return { rootPath, isGitRepo: false, items: [] };
  }

  const statusStart = lines.findIndex((line) => line.trim() === '__STATUS_BEGIN__');
  const statusEnd = lines.findIndex((line) => line.trim() === '__STATUS_END__');
  const numstatStart = lines.findIndex((line) => line.trim() === '__NUMSTAT_BEGIN__');
  const numstatEnd = lines.findIndex((line) => line.trim() === '__NUMSTAT_END__');
  const statusText = statusStart >= 0 && statusEnd > statusStart
    ? lines.slice(statusStart + 1, statusEnd).join('\n')
    : '';
  const numstatText = numstatStart >= 0 && numstatEnd > numstatStart
    ? lines.slice(numstatStart + 1, numstatEnd).join('\n')
    : '';
  const statusItems = parseGitStatusPorcelain(statusText);
  const numstatMap = parseNumstatOutput(numstatText);
  const safeLimit = parseLimit(limit, 200, 1000);
  const items = statusItems.slice(0, safeLimit).map((item) => {
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

async function loadProjectChangedFiles(project, server, limit) {
  if (project.locationType === 'ssh') {
    return loadSshProjectChangedFiles(server, project.projectPath, limit);
  }
  return loadLocalProjectChangedFiles(project.projectPath, limit);
}

async function checkLocalPath(projectPath) {
  return projectInsightsService.checkLocalProjectPath(projectPath);
}

async function checkSshPath(server, projectPath) {
  const keyPath = expandHome(server.ssh_key_path || '~/.ssh/id_rsa');
  const target = String(projectPath || '').trim();
  if (!target) throw new Error('projectPath is required');

  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=12',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server.port || 22),
  ];
  if (String(server.proxy_jump || '').trim()) {
    args.push('-J', String(server.proxy_jump).trim());
  }
  const script = buildRemotePathResolverScript(
    'if [ -d "$target" ]; then echo "__DIR_EXISTS__:$target"; elif [ -e "$target" ]; then echo "__FILE_EXISTS__:$target"; else echo "__NOT_EXISTS__:$target"; fi',
  );
  args.push(
    `${server.user}@${server.host}`,
    'bash', '-s', '--', target,
  );

  const { stdout } = await runCommand('ssh', args, { timeoutMs: 20000, input: `${script}\n` });
  const output = String(stdout || '').trim();
  const pathMatch = output.match(/:(.*)$/);
  const normalizedPath = pathMatch ? pathMatch[1] : target;
  return {
    exists: output.includes('__DIR_EXISTS__') || output.includes('__FILE_EXISTS__'),
    isDirectory: output.includes('__DIR_EXISTS__'),
    normalizedPath,
  };
}

async function ensureLocalPath(projectPath) {
  return projectInsightsService.ensureLocalProjectPath(projectPath);
}

async function ensureSshPath(server, projectPath) {
  const keyPath = expandHome(server.ssh_key_path || '~/.ssh/id_rsa');
  const target = String(projectPath || '').trim();
  if (!target) throw new Error('projectPath is required');

  const args = [
    '-o', 'BatchMode=yes',
    '-o', 'ConnectTimeout=15',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server.port || 22),
  ];
  if (String(server.proxy_jump || '').trim()) {
    args.push('-J', String(server.proxy_jump).trim());
  }
  const script = buildRemotePathResolverScript(
    'mkdir -p -- "$target"; if [ -d "$target" ]; then echo "__DIR_READY__:$target"; else echo "__NOT_DIR__:$target"; fi',
  );
  args.push(
    `${server.user}@${server.host}`,
    'bash', '-s', '--', target,
  );

  const { stdout } = await runCommand('ssh', args, { timeoutMs: 25000, input: `${script}\n` });
  const output = String(stdout || '').trim();
  const pathMatch = output.match(/:(.*)$/);
  const normalizedPath = pathMatch ? pathMatch[1] : target;
  if (!output.includes('__DIR_READY__')) {
    throw new Error(`Failed to create project path on remote server: ${target}`);
  }
  return { normalizedPath };
}

function cleanupKbSyncJobs() {
  const now = Date.now();
  for (const [jobId, job] of KB_SYNC_JOBS.entries()) {
    const endedAtMs = job?.endedAt ? Date.parse(job.endedAt) : NaN;
    const createdAtMs = job?.createdAt ? Date.parse(job.createdAt) : NaN;
    const anchor = Number.isFinite(endedAtMs) ? endedAtMs : createdAtMs;
    if (!Number.isFinite(anchor)) continue;
    if (now - anchor > KB_SYNC_JOB_TTL_MS) {
      KB_SYNC_JOBS.delete(jobId);
    }
  }
}

function createKbSyncJob({ userId, projectId, groupId }) {
  cleanupKbSyncJobs();
  const createdAt = new Date().toISOString();
  const job = {
    id: `kbjob_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    userId: String(userId || 'czk'),
    projectId: String(projectId || ''),
    groupId: Number(groupId) || null,
    status: 'QUEUED',
    stage: 'queued',
    message: 'Job queued',
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    endedAt: null,
    result: null,
    error: null,
  };
  KB_SYNC_JOBS.set(job.id, job);
  return job;
}

function patchKbSyncJob(jobId, patch = {}) {
  const current = KB_SYNC_JOBS.get(jobId);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  if (patch.status === 'RUNNING' && !next.startedAt) {
    next.startedAt = next.updatedAt;
  }
  if ((patch.status === 'SUCCEEDED' || patch.status === 'FAILED') && !next.endedAt) {
    next.endedAt = next.updatedAt;
  }
  KB_SYNC_JOBS.set(jobId, next);
  return next;
}

function getKbSyncJobForUser({ userId, projectId, jobId }) {
  const job = KB_SYNC_JOBS.get(String(jobId || '').trim());
  if (!job) return null;
  if (String(job.userId || '') !== String(userId || '')) return null;
  if (String(job.projectId || '') !== String(projectId || '')) return null;
  return job;
}

function shellEscape(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function buildRsyncSshCommand(server) {
  const sshArgs = buildSshArgs(server, { connectTimeout: 20 });
  return `ssh ${sshArgs.map((arg) => shellEscape(arg)).join(' ')}`;
}

function buildRsyncRemoteDest(server, remotePath) {
  const normalizedPath = String(remotePath || '').replace(/\/+$/, '');
  return `${server.user}@${server.host}:${shellEscape(normalizedPath)}/`;
}

async function runSshScript(server, scriptBody, args = [], timeoutMs = 30000) {
  const sshArgs = buildSshArgs(server, { connectTimeout: 20 });
  sshArgs.push(
    `${server.user}@${server.host}`,
    'bash',
    '-s',
    '--',
    ...args.map((item) => String(item ?? ''))
  );
  return runCommand('ssh', sshArgs, {
    timeoutMs,
    input: `${String(scriptBody || '').trim()}\n`,
  });
}

function sanitizeRelativePath(input = '') {
  const normalized = path.posix.normalize(String(input || '').trim().replace(/\\/g, '/'));
  if (!normalized || normalized === '.' || normalized === './') return '';
  const stripped = normalized.replace(/^\/+/, '');
  if (
    stripped === '..'
    || stripped.startsWith('../')
    || stripped.includes('/../')
    || stripped.endsWith('/..')
  ) {
    throw new Error('Path traversal is not allowed');
  }
  return stripped;
}

function resolveLocalProjectPath(projectPath, relativePath = '') {
  const rootPath = path.resolve(expandHome(String(projectPath || '').trim()));
  const safeRelativePath = sanitizeRelativePath(relativePath);
  const absolutePath = safeRelativePath
    ? path.resolve(rootPath, safeRelativePath)
    : rootPath;
  if (absolutePath !== rootPath && !absolutePath.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error('Resolved path escapes project root');
  }
  return { rootPath, safeRelativePath, absolutePath };
}

function isLikelyTextFile(relativePath = '') {
  const normalized = String(relativePath || '').trim();
  const baseName = path.basename(normalized).toLowerCase();
  if (['readme', 'license', 'dockerfile', 'makefile'].includes(baseName)) return true;
  if (baseName.endsWith('.env') || baseName.endsWith('.example')) return true;
  const ext = path.extname(baseName).toLowerCase();
  return TEXT_FILE_EXTENSIONS.has(ext);
}

function evaluatePaperResourceSignals({ paperLikeFileCount = 0, directoryCount = 0, readmeCount = 0 } = {}) {
  const paperLike = Number(paperLikeFileCount) || 0;
  const dirs = Number(directoryCount) || 0;
  const readme = Number(readmeCount) || 0;
  const score = (paperLike * 2) + readme + Math.min(dirs, 5) * 0.25;
  return {
    valid: paperLike >= 2 || score >= 5,
    score,
    paperLikeFileCount: paperLike,
    directoryCount: dirs,
    readmeCount: readme,
  };
}

async function inspectLocalResourceFolder(projectPath) {
  const { absolutePath } = resolveLocalProjectPath(projectPath, 'resource');
  const stat = await fs.stat(absolutePath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    return {
      exists: false,
      isDirectory: false,
      resourcePath: absolutePath,
      ...evaluatePaperResourceSignals({}),
    };
  }

  const { stdout } = await runCommand(
    'find',
    [
      absolutePath,
      '-maxdepth', '4',
      '(',
      '-type', 'f',
      '-o',
      '-type', 'd',
      ')',
    ],
    { timeoutMs: 30000 }
  );
  const lines = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 800);

  let paperLikeFileCount = 0;
  let directoryCount = 0;
  let readmeCount = 0;
  for (const item of lines) {
    const rel = item.startsWith(absolutePath) ? item.slice(absolutePath.length).replace(/^\/+/, '') : item;
    if (!rel) continue;
    const lower = rel.toLowerCase();
    if (lower.includes('/')) directoryCount += 1;
    if (lower.endsWith('/readme') || lower.endsWith('/readme.md') || lower === 'readme' || lower === 'readme.md') {
      readmeCount += 1;
    }
    const ext = path.extname(lower);
    if (PAPER_RESOURCE_EXTENSIONS.has(ext)) paperLikeFileCount += 1;
  }

  return {
    exists: true,
    isDirectory: true,
    resourcePath: absolutePath,
    ...evaluatePaperResourceSignals({
      paperLikeFileCount,
      directoryCount,
      readmeCount,
    }),
  };
}

async function inspectSshResourceFolder(server, projectPath) {
  const resourcePath = `${String(projectPath || '').replace(/\/+$/, '')}/resource`;
  const script = [
    'target="$1"',
    'if [ ! -e "$target" ]; then',
    '  echo "__MISSING__"',
    '  exit 0',
    'fi',
    'if [ ! -d "$target" ]; then',
    '  echo "__NOT_DIR__"',
    '  exit 0',
    'fi',
    'paper_count="$(find "$target" -maxdepth 4 -type f \\( -iname "*.pdf" -o -iname "*.md" -o -iname "*.markdown" -o -iname "*.txt" -o -iname "*.bib" -o -iname "*.tex" -o -iname "*.json" -o -iname "*.csv" \\) 2>/dev/null | wc -l | tr -d \' \')"',
    'dir_count="$(find "$target" -maxdepth 4 -type d 2>/dev/null | wc -l | tr -d \' \')"',
    'readme_count="$(find "$target" -maxdepth 4 -type f \\( -iname "readme" -o -iname "readme.md" \\) 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "__SIGNAL__:${paper_count}:${dir_count}:${readme_count}"',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [resourcePath], 30000);
  const output = String(stdout || '');
  if (output.includes('__MISSING__')) {
    return {
      exists: false,
      isDirectory: false,
      resourcePath,
      ...evaluatePaperResourceSignals({}),
    };
  }
  if (output.includes('__NOT_DIR__')) {
    return {
      exists: true,
      isDirectory: false,
      resourcePath,
      ...evaluatePaperResourceSignals({}),
    };
  }
  const line = output.split(/\r?\n/).find((item) => item.startsWith('__SIGNAL__:')) || '';
  const [, paperCountRaw = '0', dirCountRaw = '0', readmeCountRaw = '0'] = line.replace('__SIGNAL__:', '').split(':');
  return {
    exists: true,
    isDirectory: true,
    resourcePath,
    ...evaluatePaperResourceSignals({
      paperLikeFileCount: normalizeCount(paperCountRaw, 0),
      directoryCount: normalizeCount(dirCountRaw, 0),
      readmeCount: normalizeCount(readmeCountRaw, 0),
    }),
  };
}

async function isLocalDirectory(targetPath) {
  if (!targetPath) return false;
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch (_) {
    return false;
  }
}

async function resolveLocalProjectBrowseRoot(projectPath, kbFolderPath = '') {
  const projectCandidate = String(projectPath || '').trim();
  const kbCandidate = String(kbFolderPath || '').trim();
  const candidates = [];

  if (projectCandidate) {
    candidates.push({
      mode: 'project',
      resolvedPath: path.resolve(expandHome(projectCandidate)),
    });
  }

  if (kbCandidate) {
    const kbResolved = path.resolve(expandHome(kbCandidate));
    const kbParent = path.dirname(kbResolved);
    if (kbParent && kbParent !== kbResolved) {
      candidates.push({
        mode: 'kb-parent',
        resolvedPath: kbParent,
      });
    }
    candidates.push({
      mode: 'kb-folder',
      resolvedPath: kbResolved,
    });
  }

  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = String(candidate.resolvedPath || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    // eslint-disable-next-line no-await-in-loop
    const ok = await isLocalDirectory(normalized);
    if (ok) {
      return {
        rootPath: normalized,
        rootMode: candidate.mode,
      };
    }
  }

  throw new Error('Target path is not a directory');
}

async function resolveSshProjectBrowseRoot(server, projectPath, kbFolderPath = '') {
  const primaryPath = String(projectPath || '').trim();
  const kbPath = String(kbFolderPath || '').trim();
  const script = [
    'primary="$1"',
    'kb="$2"',
    'if [ -n "$primary" ] && [ -d "$primary" ]; then',
    '  echo "__ROOT__:project:$primary"',
    '  exit 0',
    'fi',
    'if [ -n "$kb" ] && [ -d "$kb" ]; then',
    '  parent="$(dirname "$kb")"',
    '  if [ -d "$parent" ]; then',
    '    echo "__ROOT__:kb-parent:$parent"',
    '  else',
    '    echo "__ROOT__:kb-folder:$kb"',
    '  fi',
    '  exit 0',
    'fi',
    'if [ -n "$kb" ]; then',
    '  parent="$(dirname "$kb")"',
    '  if [ -d "$parent" ]; then',
    '    echo "__ROOT__:kb-parent:$parent"',
    '    exit 0',
    '  fi',
    'fi',
    'echo "__NOT_DIR__"',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [primaryPath, kbPath], 30000);
  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const rootLine = lines.find((line) => line.startsWith('__ROOT__:')) || '';
  if (!rootLine) throw new Error('Target path is not a directory');

  const payload = rootLine.slice('__ROOT__:'.length);
  const separatorIndex = payload.indexOf(':');
  if (separatorIndex < 0) {
    return { rootMode: 'project', rootPath: payload.trim() };
  }
  return {
    rootMode: payload.slice(0, separatorIndex).trim() || 'project',
    rootPath: payload.slice(separatorIndex + 1).trim(),
  };
}

async function resolveProjectBrowseRoot(project, server) {
  if (!project) throw new Error('Project not found');
  const kbFolderPath = String(project.kbFolderPath || '').trim();
  if (project.locationType === 'ssh') {
    return resolveSshProjectBrowseRoot(server, project.projectPath, kbFolderPath);
  }
  return resolveLocalProjectBrowseRoot(project.projectPath, kbFolderPath);
}

async function listLocalProjectDirectory(projectPath, relativePath = '', limit = 200) {
  const { rootPath, safeRelativePath, absolutePath } = resolveLocalProjectPath(projectPath, relativePath);
  const dirStat = await fs.stat(absolutePath);
  if (!dirStat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${absolutePath}`);
  }
  const cap = parseLimit(limit, 200, 500);
  const children = await fs.readdir(absolutePath, { withFileTypes: true });
  const sorted = children
    .filter((entry) => entry.name !== '.' && entry.name !== '..')
    .sort((a, b) => {
      const aDir = a.isDirectory() ? 0 : 1;
      const bDir = b.isDirectory() ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });
  const entries = sorted.slice(0, cap).map((entry) => {
    const relative = safeRelativePath
      ? `${safeRelativePath}/${entry.name}`
      : entry.name;
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : (entry.isFile() ? 'file' : 'other'),
      relativePath: relative,
    };
  });
  const parentPath = safeRelativePath.includes('/')
    ? safeRelativePath.split('/').slice(0, -1).join('/')
    : '';
  return {
    rootPath,
    currentPath: safeRelativePath,
    parentPath,
    entries,
    totalEntries: sorted.length,
    truncated: sorted.length > entries.length,
  };
}

async function listSshProjectDirectory(server, projectPath, relativePath = '', limit = 200) {
  const safeRelativePath = sanitizeRelativePath(relativePath);
  const encodedRelativePath = safeRelativePath || '__ROOT__';
  const rootPath = String(projectPath || '').trim();
  const cap = parseLimit(limit, 200, 500);
  const script = [
    'root="$1"',
    'rel_encoded="$2"',
    'if [ "$rel_encoded" = "__ROOT__" ]; then rel=""; else rel="$rel_encoded"; fi',
    'lim="$3"',
    'if ! printf "%s" "$lim" | grep -Eq "^[0-9]+$"; then lim=200; fi',
    'if [ "$lim" -lt 1 ]; then lim=1; fi',
    'if [ "$lim" -gt 500 ]; then lim=500; fi',
    'if [ -n "$rel" ]; then target="$root/$rel"; else target="$root"; fi',
    'if [ ! -d "$target" ]; then',
    '  echo "__NOT_DIR__"',
    '  exit 0',
    'fi',
    'echo "__ROOT__:$root"',
    'echo "__CURRENT__:$rel"',
    'count=0',
    'for item in "$target"/* "$target"/.[!.]* "$target"/..?*; do',
    '  [ -e "$item" ] || continue',
    '  name="$(basename "$item")"',
    '  [ "$name" = "." ] && continue',
    '  [ "$name" = ".." ] && continue',
    '  if [ -d "$item" ]; then kind="directory";',
    '  elif [ -f "$item" ]; then kind="file";',
    '  else kind="other"; fi',
    '  printf "__ENTRY__:%s\\037%s\\n" "$kind" "$name"',
    '  count=$((count + 1))',
    '  if [ "$count" -ge "$lim" ]; then break; fi',
    'done',
    'total="$(find "$target" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "__TOTAL__:$total"',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [rootPath, encodedRelativePath, String(cap)], 30000);
  if (String(stdout || '').includes('__NOT_DIR__')) {
    const requestedPath = safeRelativePath ? `${rootPath}/${safeRelativePath}` : rootPath;
    throw new Error(`Target path is not a directory: ${requestedPath}`);
  }

  const lines = String(stdout || '').split(/\r?\n/).filter(Boolean);
  const entries = lines
    .filter((line) => line.startsWith('__ENTRY__:'))
    .map((line) => line.slice('__ENTRY__:'.length))
    .map((encoded) => {
      const [kind = 'other', name = ''] = encoded.split('\u001f');
      const relative = safeRelativePath ? `${safeRelativePath}/${name}` : name;
      return {
        name,
        type: kind,
        relativePath: relative,
      };
    })
    .filter((entry) => entry.name);
  const totalLine = lines.find((line) => line.startsWith('__TOTAL__:')) || '';
  const totalEntries = normalizeCount(totalLine.slice('__TOTAL__:'.length), entries.length);
  const parentPath = safeRelativePath.includes('/')
    ? safeRelativePath.split('/').slice(0, -1).join('/')
    : '';
  return {
    rootPath,
    currentPath: safeRelativePath,
    parentPath,
    entries,
    totalEntries,
    truncated: totalEntries > entries.length,
  };
}

async function readLocalProjectTextFile(projectPath, relativePath, maxBytes = 120000) {
  const { rootPath, safeRelativePath, absolutePath } = resolveLocalProjectPath(projectPath, relativePath);
  if (!safeRelativePath) throw new Error('A file path is required');
  const fileStat = await fs.stat(absolutePath);
  if (!fileStat.isFile()) throw new Error('Target path is not a file');
  if (!isLikelyTextFile(safeRelativePath)) {
    throw new Error('Only text/code files can be previewed');
  }

  const cap = parseLimit(maxBytes, 120000, 512000);
  const fd = await fs.open(absolutePath, 'r');
  try {
    const buffer = Buffer.alloc(cap);
    const { bytesRead } = await fd.read(buffer, 0, cap, 0);
    return {
      rootPath,
      relativePath: safeRelativePath,
      sizeBytes: Number(fileStat.size) || 0,
      truncated: Number(fileStat.size) > bytesRead,
      content: buffer.subarray(0, bytesRead).toString('utf8'),
    };
  } finally {
    await fd.close();
  }
}

async function readSshProjectTextFile(server, projectPath, relativePath, maxBytes = 120000) {
  const safeRelativePath = sanitizeRelativePath(relativePath);
  if (!safeRelativePath) throw new Error('A file path is required');
  if (!isLikelyTextFile(safeRelativePath)) {
    throw new Error('Only text/code files can be previewed');
  }

  const cap = parseLimit(maxBytes, 120000, 512000);
  const rootPath = String(projectPath || '').trim();
  const script = [
    'root="$1"',
    'rel="$2"',
    'cap="$3"',
    'if [ -n "$rel" ]; then target="$root/$rel"; else target="$root"; fi',
    'if [ ! -f "$target" ]; then echo "__NOT_FILE__"; exit 0; fi',
    'size="$(wc -c < "$target" | tr -d \' \')"',
    'echo "__SIZE__:$size"',
    'printf "__B64__:"',
    'head -c "$cap" "$target" | base64 | tr -d \'\\n\'',
    'echo',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [rootPath, safeRelativePath, String(cap)], 30000);
  const output = String(stdout || '');
  if (output.includes('__NOT_FILE__')) {
    throw new Error('Target path is not a file');
  }
  const sizeLine = output.split(/\r?\n/).find((line) => line.startsWith('__SIZE__:')) || '';
  const b64Line = output.split(/\r?\n/).find((line) => line.startsWith('__B64__:')) || '';
  const sizeBytes = normalizeCount(sizeLine.slice('__SIZE__:'.length), 0);
  const encoded = b64Line.slice('__B64__:'.length).trim();
  const decoded = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '';
  return {
    rootPath,
    relativePath: safeRelativePath,
    sizeBytes,
    truncated: sizeBytes > Buffer.byteLength(decoded, 'utf8'),
    content: decoded,
  };
}

async function searchLocalProjectFiles(projectPath, query, limit = 20) {
  const rootPath = path.resolve(expandHome(String(projectPath || '').trim()));
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const cap = parseLimit(limit, 20, 100);
  let candidates = [];
  try {
    const tracked = await runCommand('git', ['-C', rootPath, 'ls-files'], { timeoutMs: 10000 });
    const untracked = await runCommand('git', ['-C', rootPath, 'ls-files', '--others', '--exclude-standard'], { timeoutMs: 10000 })
      .catch(() => ({ stdout: '' }));
    candidates = `${tracked.stdout || ''}\n${untracked.stdout || ''}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (_) {
    const fallback = await runCommand('find', [rootPath, '-type', 'f'], { timeoutMs: 25000 });
    candidates = String(fallback.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((filePath) => path.relative(rootPath, filePath).replace(/\\/g, '/'));
  }

  return [...new Set(candidates)]
    .filter((filePath) => filePath.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, cap);
}

async function searchSshProjectFiles(server, projectPath, query, limit = 20) {
  const q = String(query || '').trim();
  if (!q) return [];
  const cap = parseLimit(limit, 20, 100);
  const script = [
    'root="$1"',
    'query="$2"',
    'limit="$3"',
    'if ! printf "%s" "$limit" | grep -Eq "^[0-9]+$"; then limit=20; fi',
    'if [ "$limit" -lt 1 ]; then limit=1; fi',
    'if [ "$limit" -gt 100 ]; then limit=100; fi',
    'if [ ! -d "$root" ]; then echo "__NOT_DIR__"; exit 0; fi',
    'query_lc="$(printf "%s" "$query" | tr "[:upper:]" "[:lower:]")"',
    'count=0',
    'find "$root" -type f 2>/dev/null | while IFS= read -r file; do',
    '  rel="${file#$root/}"',
    '  rel_lc="$(printf "%s" "$rel" | tr "[:upper:]" "[:lower:]")"',
    '  case "$rel_lc" in',
    '    *"$query_lc"*)',
    '      echo "$rel"',
    '      count=$((count + 1))',
    '      if [ "$count" -ge "$limit" ]; then break; fi',
    '      ;;',
    '  esac',
    'done',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [String(projectPath || '').trim(), q, String(cap)], 35000);
  if (String(stdout || '').includes('__NOT_DIR__')) {
    return [];
  }
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, cap);
}

function toRelativePosixPath(rootPath, absolutePath) {
  const root = String(rootPath || '').trim();
  const absolute = String(absolutePath || '').trim();
  if (!root || !absolute) return '';
  if (absolute === root) return '';
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1);
  const fallback = path.relative(root, absolute).replace(/\\/g, '/');
  if (fallback.startsWith('../') || fallback === '..') return '';
  return fallback;
}

async function listLocalKnowledgeBaseFiles(kbFolderPath, { offset = 0, limit = 3 } = {}) {
  const rootPath = path.resolve(expandHome(String(kbFolderPath || '').trim()));
  const rootStat = await fs.stat(rootPath).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error('KB folder is not a directory');
  }

  const safeOffset = parseOffset(offset, 0, 100000);
  const safeLimit = parseLimit(limit, 3, 120);
  const { stdout } = await runCommand('find', [rootPath, '-type', 'f'], { timeoutMs: 40000 });
  const allFiles = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .map((filePath) => toRelativePosixPath(rootPath, filePath))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const page = allFiles.slice(safeOffset, safeOffset + safeLimit);
  return {
    rootPath,
    items: page.map((relativePath) => ({
      relativePath,
      name: path.posix.basename(relativePath),
    })),
    totalFiles: allFiles.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + page.length < allFiles.length,
  };
}

async function listSshKnowledgeBaseFiles(server, kbFolderPath, { offset = 0, limit = 3 } = {}) {
  const rootPath = String(kbFolderPath || '').trim();
  const safeOffset = parseOffset(offset, 0, 100000);
  const safeLimit = parseLimit(limit, 3, 120);
  const script = [
    'root="$1"',
    'off="$2"',
    'lim="$3"',
    'if ! printf "%s" "$off" | grep -Eq "^[0-9]+$"; then off=0; fi',
    'if ! printf "%s" "$lim" | grep -Eq "^[0-9]+$"; then lim=3; fi',
    'if [ "$off" -lt 0 ]; then off=0; fi',
    'if [ "$lim" -lt 1 ]; then lim=1; fi',
    'if [ "$lim" -gt 120 ]; then lim=120; fi',
    'if [ ! -d "$root" ]; then',
    '  echo "__NOT_DIR__"',
    '  exit 0',
    'fi',
    'find "$root" -type f 2>/dev/null | LC_ALL=C sort | awk -v off="$off" -v lim="$lim" \'NR>off && NR<=off+lim {print "__ITEM__:" $0} END {print "__TOTAL__:" NR}\'',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [rootPath, String(safeOffset), String(safeLimit)], 45000);
  const output = String(stdout || '');
  if (output.includes('__NOT_DIR__')) {
    throw new Error('KB folder is not a directory');
  }

  const lines = output.split(/\r?\n/).filter(Boolean);
  const items = lines
    .filter((line) => line.startsWith('__ITEM__:'))
    .map((line) => line.slice('__ITEM__:'.length).trim())
    .map((absolutePath) => toRelativePosixPath(rootPath, absolutePath))
    .filter(Boolean)
    .map((relativePath) => ({
      relativePath,
      name: path.posix.basename(relativePath),
    }));
  const totalLine = lines.find((line) => line.startsWith('__TOTAL__:')) || '';
  const totalFiles = normalizeCount(totalLine.slice('__TOTAL__:'.length), items.length);
  return {
    rootPath,
    items,
    totalFiles,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + items.length < totalFiles,
  };
}

function normalizeSyncFilename(title = '', index = 0, mimeType = '') {
  const fallback = `paper_${String(index + 1).padStart(3, '0')}`;
  const raw = String(title || '').trim() || fallback;
  const cleaned = raw
    .replace(/[^\w\-. ]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || fallback;
  const extFromMime = String(mimeType || '').toLowerCase().includes('pdf') ? '.pdf' : '.md';
  const ext = path.extname(cleaned) ? '' : extFromMime;
  return `${cleaned}${ext}`;
}

async function listKnowledgeGroupSyncDocuments(userId, groupId, { limit = 300 } = {}) {
  const db = getDb();
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) return [];
  const cap = parseLimit(limit, 300, 1000);
  const result = await db.execute({
    sql: `
      SELECT d.id, d.title, d.s3_key, d.mime_type, d.original_url
      FROM knowledge_group_documents kgd
      JOIN knowledge_groups kg ON kg.id = kgd.group_id
      JOIN documents d ON d.id = kgd.document_id
      WHERE kg.id = ? AND kg.user_id = ? AND d.user_id = ?
      ORDER BY kgd.created_at DESC, d.id DESC
      LIMIT ?
    `,
    args: [gid, String(userId || 'czk'), String(userId || 'czk'), cap],
  });
  return result.rows || [];
}

async function syncDocumentsToLocalResourceFolder(localResourceDir, targetResourcePath) {
  await fs.mkdir(targetResourcePath, { recursive: true });
  await runCommand('rsync', ['-az', `${localResourceDir}/`, `${targetResourcePath}/`], { timeoutMs: 120000 });
}

async function syncDocumentsToSshResourceFolder(server, localResourceDir, targetResourcePath) {
  await ensureSshPath(server, targetResourcePath);
  const rsyncCommand = buildRsyncSshCommand(server);
  const destination = buildRsyncRemoteDest(server, targetResourcePath);
  await runCommand(
    'rsync',
    ['-az', '-e', rsyncCommand, `${localResourceDir}/`, destination],
    { timeoutMs: 180000 }
  );
}

async function executeKbGroupSyncJob(jobId, { userId, project, server, group }) {
  patchKbSyncJob(jobId, {
    status: 'RUNNING',
    stage: 'preparing',
    message: `Preparing paper group "${group.name}"`,
  });

  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-sync-'));
  const localResourceDir = path.join(tmpRoot, 'resource');
  await fs.mkdir(localResourceDir, { recursive: true });

  try {
    patchKbSyncJob(jobId, { stage: 'fetching', message: 'Fetching paper files from storage' });
    const documents = await listKnowledgeGroupSyncDocuments(userId, group.id, { limit: 300 });
    if (!documents.length) {
      throw new Error('Selected paper group has no documents');
    }

    const usedNames = new Set();
    let syncedCount = 0;
    let skippedCount = 0;

    for (let index = 0; index < documents.length; index += 1) {
      const doc = documents[index];
      const key = String(doc.s3_key || '').trim();
      if (!key) {
        skippedCount += 1;
        continue;
      }
      let filename = normalizeSyncFilename(doc.title, index, doc.mime_type);
      while (usedNames.has(filename)) {
        const ext = path.extname(filename);
        const stem = filename.slice(0, ext ? -ext.length : undefined);
        filename = `${stem}_${Math.random().toString(36).slice(2, 6)}${ext}`;
      }
      usedNames.add(filename);
      // eslint-disable-next-line no-await-in-loop
      const content = await s3Service.downloadBuffer(key).catch(() => null);
      if (!content || !Buffer.isBuffer(content)) {
        skippedCount += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(path.join(localResourceDir, filename), content);
      syncedCount += 1;
    }

    if (syncedCount === 0) {
      throw new Error('No files could be synchronized from this paper group');
    }

    const manifest = {
      generatedAt: new Date().toISOString(),
      groupId: Number(group.id),
      groupName: group.name,
      totalRequested: documents.length,
      syncedCount,
      skippedCount,
    };
    await fs.writeFile(
      path.join(localResourceDir, '_kb_manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    );

    const targetResourcePath = `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
    patchKbSyncJob(jobId, {
      stage: 'syncing',
      message: project.locationType === 'ssh'
        ? 'Syncing files to remote project resource folder'
        : 'Syncing files to local project resource folder',
    });
    if (project.locationType === 'ssh') {
      await syncDocumentsToSshResourceFolder(server, localResourceDir, targetResourcePath);
    } else {
      await syncDocumentsToLocalResourceFolder(localResourceDir, targetResourcePath);
    }

    const currentProject = await researchOpsStore.getProject(userId, project.id);
    const nextGroupIds = new Set([...(currentProject?.knowledgeGroupIds || []), Number(group.id)]);
    await researchOpsStore.setProjectKnowledgeGroups(userId, project.id, Array.from(nextGroupIds));
    const updatedProject = await researchOpsStore.setProjectKnowledgeBaseFolder(userId, project.id, targetResourcePath);

    patchKbSyncJob(jobId, {
      status: 'SUCCEEDED',
      stage: 'done',
      message: `Knowledge base synchronized (${syncedCount} files)`,
      result: {
        syncedCount,
        skippedCount,
        resourcePath: targetResourcePath,
        project: updatedProject,
      },
      error: null,
    });
  } catch (error) {
    patchKbSyncJob(jobId, {
      status: 'FAILED',
      stage: 'failed',
      message: 'Knowledge base synchronization failed',
      error: sanitizeError(error, 'Failed to sync paper group'),
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  }
}

router.use(requireAuth);

router.get('/health', async (req, res) => {
  try {
    await researchOpsStore.initStore();
    res.json({
      status: 'ok',
      storeMode: researchOpsStore.getStoreMode(),
      running: researchOpsRunner.getRunningState().length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to initialize ResearchOps store',
      message: sanitizeError(error),
    });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const userId = getUserId(req);
    const projectLimit = parseLimit(req.query.projectLimit, 80, 300);
    const itemLimit = parseLimit(req.query.itemLimit, 120, 400);
    const [projects, ideas, queue, runs, skills] = await Promise.all([
      researchOpsStore.listProjects(userId, { limit: projectLimit }),
      researchOpsStore.listIdeas(userId, { limit: itemLimit }),
      researchOpsStore.listQueue(userId, { limit: itemLimit }),
      researchOpsStore.listRuns(userId, { limit: itemLimit }),
      researchOpsStore.listSkills(userId),
    ]);
    return res.json({
      projects,
      ideas,
      queue,
      runs,
      skills,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] dashboard failed:', error);
    return res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

// Projects
router.get('/projects', async (req, res) => {
  try {
    const items = await researchOpsStore.listProjects(getUserId(req), {
      limit: parseLimit(req.query.limit, 50, 200),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listProjects failed:', error);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

router.post('/projects', async (req, res) => {
  try {
    const locationType = String(req.body?.locationType || '').trim().toLowerCase() || 'local';
    const projectPath = String(req.body?.projectPath || '').trim();
    const serverId = String(req.body?.serverId || '').trim();
    if (!projectPath) {
      return res.status(400).json({ error: 'projectPath is required' });
    }
    if (!['local', 'ssh'].includes(locationType)) {
      return res.status(400).json({ error: 'locationType must be local or ssh' });
    }

    let ensuredPath = projectPath;
    let ensuredServerId;
    if (locationType === 'local') {
      if (config.projectInsights?.proxyHeavyOps === true) {
        try {
          const result = await projectInsightsProxy.ensurePath({ projectPath });
          ensuredPath = String(result?.normalizedPath || '').trim() || path.resolve(expandHome(projectPath));
        } catch (proxyError) {
          return res.status(502).json({
            error: sanitizeError(proxyError, 'Local executor unavailable for local project path creation'),
          });
        }
      } else {
        const result = await ensureLocalPath(projectPath);
        ensuredPath = result.normalizedPath;
      }
    } else {
      if (!serverId) {
        return res.status(400).json({ error: 'serverId is required when locationType=ssh' });
      }
      const db = getDb();
      const serverResult = await db.execute({
        sql: `SELECT * FROM ssh_servers WHERE id = ?`,
        args: [serverId],
      });
      if (!serverResult.rows.length) {
        return res.status(404).json({ error: `SSH server ${serverId} not found` });
      }
      const server = serverResult.rows[0];
      const result = await ensureSshPath(server, projectPath);
      ensuredPath = result.normalizedPath;
      ensuredServerId = String(server.id);
    }

    const project = await researchOpsStore.createProject(getUserId(req), {
      name: req.body?.name,
      description: req.body?.description,
      locationType,
      serverId: locationType === 'ssh' ? ensuredServerId : undefined,
      projectPath: ensuredPath,
    });
    res.status(201).json({ project });
  } catch (error) {
    console.error('[ResearchOps] createProject failed:', error);
    res.status(400).json({ error: sanitizeError(error, 'Failed to create project') });
  }
});

router.post('/projects/path-check', async (req, res) => {
  try {
    const locationType = String(req.body?.locationType || '').trim().toLowerCase() || 'local';
    const projectPath = String(req.body?.projectPath || '').trim();
    const serverId = String(req.body?.serverId || '').trim();
    if (!projectPath) return res.status(400).json({ error: 'projectPath is required' });
    if (!['local', 'ssh'].includes(locationType)) {
      return res.status(400).json({ error: 'locationType must be local or ssh' });
    }

    if (locationType === 'local') {
      const usingProxy = config.projectInsights?.proxyHeavyOps === true;
      let result = null;

      if (usingProxy) {
        try {
          result = await projectInsightsProxy.checkPath({ projectPath });
        } catch (proxyError) {
          return res.status(502).json({
            error: sanitizeError(proxyError, 'Local executor unavailable for local project path check'),
          });
        }
      } else {
        result = await checkLocalPath(projectPath);
      }

      return res.json({
        locationType,
        serverId: 'local-default',
        projectPath: result.normalizedPath,
        exists: result.exists,
        isDirectory: result.isDirectory,
        canCreate: !result.exists || result.isDirectory,
        viaProxy: usingProxy,
        message: result.exists
          ? (result.isDirectory ? 'Path exists and is a directory.' : 'Path exists but is not a directory.')
          : `Path does not exist on ${usingProxy ? 'local executor' : 'backend host'}. It will be created with mkdir -p on project creation.`,
      });
    }

    if (!serverId) return res.status(400).json({ error: 'serverId is required for ssh location' });
    const db = getDb();
    const serverResult = await db.execute({
      sql: `SELECT * FROM ssh_servers WHERE id = ?`,
      args: [serverId],
    });
    if (!serverResult.rows.length) {
      return res.status(404).json({ error: `SSH server ${serverId} not found` });
    }
    const server = serverResult.rows[0];
    const result = await checkSshPath(server, projectPath);
    return res.json({
      locationType,
      serverId: String(server.id),
      projectPath: result.normalizedPath,
      exists: result.exists,
      isDirectory: result.isDirectory,
      canCreate: !result.exists || result.isDirectory,
      message: result.exists
        ? (result.isDirectory ? 'Remote path exists and is a directory.' : 'Remote path exists but is not a directory.')
        : 'Remote path does not exist. It will be created with mkdir -p on project creation.',
    });
  } catch (error) {
    console.error('[ResearchOps] path-check failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to check project path') });
  }
});

router.get('/projects/:projectId/git-log', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const gitLimit = parseLimit(req.query.limit, 25, 120);
    let proxied = false;
    let gitProgress = null;

    if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
      try {
        gitProgress = await projectInsightsProxy.getGitLog({
          projectPath: project.projectPath,
          limit: gitLimit,
        });
        proxied = true;
      } catch (proxyError) {
        console.warn('[ResearchOps] project git-log proxy failed, falling back to direct execution:', proxyError.message);
      }
    }

    if (!gitProgress) {
      gitProgress = await loadProjectGitProgress(project, server, gitLimit);
    }

    return res.json({
      projectId: project.id,
      locationType: project.locationType,
      serverId: project.serverId || 'local-default',
      projectPath: project.projectPath,
      proxied,
      ...gitProgress,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (error.code === 'SSH_SERVER_NOT_FOUND') {
      return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    }
    console.error('[ResearchOps] project git-log failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load project git log') });
  }
});

router.get('/projects/:projectId/server-files', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const sampleLimit = parseLimit(req.query.sampleLimit, 40, 120);
    let proxied = false;
    let fileSummary = null;

    if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
      try {
        fileSummary = await projectInsightsProxy.getServerFiles({
          projectPath: project.projectPath,
          sampleLimit,
        });
        proxied = true;
      } catch (proxyError) {
        console.warn('[ResearchOps] project server-files proxy failed, falling back to direct execution:', proxyError.message);
      }
    }

    if (!fileSummary) {
      fileSummary = await loadProjectFiles(project, server, sampleLimit);
    }

    return res.json({
      projectId: project.id,
      locationType: project.locationType,
      serverId: project.serverId || 'local-default',
      projectPath: project.projectPath,
      proxied,
      ...fileSummary,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (error.code === 'SSH_SERVER_NOT_FOUND') {
      return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    }
    console.error('[ResearchOps] project server-files failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load project files') });
  }
});

router.get('/projects/:projectId/changed-files', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const limit = parseLimit(req.query.limit, 200, 1000);
    let proxied = false;
    let changed = null;

    if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
      try {
        changed = await projectInsightsProxy.getChangedFiles({
          projectPath: project.projectPath,
          limit,
        });
        proxied = true;
      } catch (proxyError) {
        console.warn('[ResearchOps] project changed-files proxy failed, falling back to direct execution:', proxyError.message);
      }
    }

    if (!changed) {
      changed = await loadProjectChangedFiles(project, server, limit);
    }

    return res.json({
      projectId: project.id,
      locationType: project.locationType,
      serverId: project.serverId || 'local-default',
      projectPath: project.projectPath,
      proxied,
      ...changed,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'Project not found' });
    }
    if (error.code === 'SSH_SERVER_NOT_FOUND') {
      return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    }
    console.error('[ResearchOps] project changed-files failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load project changed files') });
  }
});

router.get('/projects/:projectId', async (req, res) => {
  try {
    const project = await researchOpsStore.getProject(getUserId(req), req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    return res.json({ project });
  } catch (error) {
    console.error('[ResearchOps] getProject failed:', error);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

router.post('/projects/:projectId/kb/setup-from-resource', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const userId = getUserId(req);
    const { project, server } = await resolveProjectContext(userId, projectId);

    const inspection = project.locationType === 'ssh'
      ? await inspectSshResourceFolder(server, project.projectPath)
      : await inspectLocalResourceFolder(project.projectPath);

    if (!inspection.exists || !inspection.isDirectory) {
      return res.status(400).json({
        error: 'resource/ folder was not found in this project',
        inspection,
      });
    }
    if (!inspection.valid) {
      return res.status(400).json({
        error: 'resource/ exists but does not look like a paper resource folder',
        inspection,
      });
    }

    const updatedProject = await researchOpsStore.setProjectKnowledgeBaseFolder(
      userId,
      project.id,
      inspection.resourcePath
    );
    return res.json({
      success: true,
      message: 'resource/ folder validated and linked as project KB',
      inspection,
      project: updatedProject,
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] setup-from-resource failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to setup KB from resource folder') });
  }
});

router.post('/projects/:projectId/kb/sync-group', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const groupId = Number(req.body?.groupId);
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    if (!Number.isFinite(groupId) || groupId <= 0) {
      return res.status(400).json({ error: 'groupId is required' });
    }

    const userId = getUserId(req);
    const { project, server } = await resolveProjectContext(userId, projectId);
    const group = await knowledgeGroupsService.getKnowledgeGroup(userId, groupId);
    if (!group) return res.status(404).json({ error: 'Knowledge group not found' });

    const job = createKbSyncJob({ userId, projectId: project.id, groupId });
    void executeKbGroupSyncJob(job.id, {
      userId,
      project,
      server,
      group,
    });

    return res.status(202).json({
      accepted: true,
      job,
      message: 'KB sync started in background',
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] kb sync-group failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to start KB sync job') });
  }
});

router.get('/projects/:projectId/kb/sync-jobs/:jobId', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const jobId = String(req.params.jobId || '').trim();
    if (!projectId || !jobId) return res.status(400).json({ error: 'projectId and jobId are required' });

    const job = getKbSyncJobForUser({
      userId: getUserId(req),
      projectId,
      jobId,
    });
    if (!job) return res.status(404).json({ error: 'KB sync job not found' });
    return res.json({ job });
  } catch (error) {
    console.error('[ResearchOps] get KB sync job failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch KB sync job') });
  }
});

router.get('/projects/:projectId/kb/files', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const limit = parseLimit(req.query.limit, 3, 120);
    const offset = parseOffset(req.query.offset, 0, 100000);
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const kbFolderPathRaw = String(project.kbFolderPath || '').trim();
    const kbFolderPath = kbFolderPathRaw
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;

    if (!kbFolderPath) {
      return res.json({
        projectId: project.id,
        kbFolderPath: '',
        rootPath: '',
        items: [],
        totalFiles: 0,
        offset,
        limit,
        hasMore: false,
        refreshedAt: new Date().toISOString(),
      });
    }

    const listing = project.locationType === 'ssh'
      ? await listSshKnowledgeBaseFiles(server, kbFolderPath, { offset, limit })
      : await listLocalKnowledgeBaseFiles(kbFolderPath, { offset, limit });
    return res.json({
      projectId: project.id,
      kbFolderPath,
      ...listing,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] kb/files failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load KB files') });
  }
});

router.get('/projects/:projectId/files/tree', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const relativePath = String(req.query.path || '').trim();
    const limit = parseLimit(req.query.limit, 200, 500);
    const scope = String(req.query.scope || 'project').trim().toLowerCase();
    const kbRootPath = String(project.kbFolderPath || '').trim()
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
    const browseRoot = scope === 'kb'
      ? { rootMode: 'kb-folder', rootPath: kbRootPath }
      : await resolveProjectBrowseRoot(project, server);
    if (!browseRoot.rootPath) {
      return res.status(400).json({ error: 'No accessible root path found for file browser' });
    }
    const tree = project.locationType === 'ssh'
      ? await listSshProjectDirectory(server, browseRoot.rootPath, relativePath, limit)
      : await listLocalProjectDirectory(browseRoot.rootPath, relativePath, limit);
    return res.json({
      projectId: project.id,
      rootMode: browseRoot.rootMode,
      ...tree,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] files/tree failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load project file tree') });
  }
});

router.get('/projects/:projectId/files/content', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const relativePath = String(req.query.path || '').trim();
    if (!relativePath) return res.status(400).json({ error: 'path is required' });
    const maxBytes = parseLimit(req.query.maxBytes, 120000, 512000);
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const scope = String(req.query.scope || 'project').trim().toLowerCase();
    const kbRootPath = String(project.kbFolderPath || '').trim()
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
    const browseRoot = scope === 'kb'
      ? { rootMode: 'kb-folder', rootPath: kbRootPath }
      : await resolveProjectBrowseRoot(project, server);
    if (!browseRoot.rootPath) {
      return res.status(400).json({ error: 'No accessible root path found for file browser' });
    }
    const file = project.locationType === 'ssh'
      ? await readSshProjectTextFile(server, browseRoot.rootPath, relativePath, maxBytes)
      : await readLocalProjectTextFile(browseRoot.rootPath, relativePath, maxBytes);
    return res.json({
      projectId: project.id,
      rootMode: browseRoot.rootMode,
      ...file,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] files/content failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to read project file content') });
  }
});

router.get('/projects/:projectId/files/search', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const query = String(req.query.q || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    if (!query) return res.json({ items: [] });
    const limit = parseLimit(req.query.limit, 20, 100);
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const scope = String(req.query.scope || 'project').trim().toLowerCase();
    const kbRootPath = String(project.kbFolderPath || '').trim()
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
    const browseRoot = scope === 'kb'
      ? { rootMode: 'kb-folder', rootPath: kbRootPath }
      : await resolveProjectBrowseRoot(project, server);
    if (!browseRoot.rootPath) {
      return res.status(400).json({ error: 'No accessible root path found for file browser' });
    }
    const items = project.locationType === 'ssh'
      ? await searchSshProjectFiles(server, browseRoot.rootPath, query, limit)
      : await searchLocalProjectFiles(browseRoot.rootPath, query, limit);
    return res.json({
      projectId: project.id,
      rootMode: browseRoot.rootMode,
      items,
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] files/search failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to search project files') });
  }
});

router.post('/projects/:projectId/files/augment', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const filePath = String(req.body?.filePath || '').trim();
    const instruction = String(req.body?.instruction || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    if (!filePath) return res.status(400).json({ error: 'filePath is required' });
    if (!instruction) return res.status(400).json({ error: 'instruction is required' });

    const userId = getUserId(req);
    const project = await researchOpsStore.getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const safeRelativePath = sanitizeRelativePath(filePath);
    if (!safeRelativePath) return res.status(400).json({ error: 'Invalid filePath' });
    const defaultProjectCwd = String(project.projectPath || '').trim();
    const serverId = String(project.serverId || '').trim() || 'local-default';

    const prompt = [
      `Apply one focused augmentation to file "${safeRelativePath}" in this project.`,
      'Requirements:',
      '1) Edit only the target file unless absolutely required.',
      '2) Keep current style and architecture.',
      '3) Explain exactly what changed and why in a short summary.',
      '',
      `User request: ${instruction}`,
    ].join('\n');

    const run = await researchOpsStore.enqueueRun(userId, {
      projectId: project.id,
      serverId,
      runType: 'AGENT',
      provider: 'codex_cli',
      schemaVersion: '2.0',
      mode: 'headless',
      workflow: [
        {
          id: 'agent_augment',
          type: 'agent.run',
          inputs: {
            prompt,
            provider: 'codex_cli',
          },
        },
        {
          id: 'report',
          type: 'report.render',
          inputs: { format: 'md+json' },
        },
      ],
      metadata: {
        prompt,
        augmentationTargetPath: safeRelativePath,
        cwd: defaultProjectCwd || undefined,
      },
    });
    return res.status(201).json({
      success: true,
      message: 'Augmentation run queued',
      run,
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    console.error('[ResearchOps] files/augment failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to queue augmentation run') });
  }
});

router.put('/projects/:projectId/knowledge-groups', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const rawGroupIds = Array.isArray(req.body?.groupIds) ? req.body.groupIds : [];
    const parsedGroupIds = [...new Set(rawGroupIds.map((item) => Number(item)).filter((num) => Number.isFinite(num) && num > 0))];

    let groups = [];
    if (parsedGroupIds.length > 0) {
      const groupsResult = await knowledgeGroupsService.listKnowledgeGroups(getUserId(req), {
        ids: parsedGroupIds,
        limit: parsedGroupIds.length,
        offset: 0,
      });
      groups = groupsResult.items;
    }
    const validIds = groups.map((item) => Number(item.id));

    const project = await researchOpsStore.setProjectKnowledgeGroups(getUserId(req), projectId, validIds);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    return res.json({
      project,
      knowledgeGroups: groups,
    });
  } catch (error) {
    console.error('[ResearchOps] setProjectKnowledgeGroups failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update project knowledge groups') });
  }
});

router.get('/projects/:projectId/knowledge-groups', async (req, res) => {
  try {
    const project = await researchOpsStore.getProject(getUserId(req), req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const groupIds = Array.isArray(project.knowledgeGroupIds) ? project.knowledgeGroupIds : [];
    let items = [];
    if (groupIds.length > 0) {
      const groupsResult = await knowledgeGroupsService.listKnowledgeGroups(getUserId(req), {
        ids: groupIds,
        limit: groupIds.length,
        offset: 0,
      });
      items = groupsResult.items;
    }
    return res.json({
      projectId: project.id,
      groupIds,
      items,
    });
  } catch (error) {
    console.error('[ResearchOps] listProjectKnowledgeGroups failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch project knowledge groups') });
  }
});

// Knowledge groups
router.get('/knowledge-groups', async (req, res) => {
  try {
    const result = await knowledgeGroupsService.listKnowledgeGroups(getUserId(req), {
      limit: parseLimit(req.query.limit, 20, 200),
      offset: parseOffset(req.query.offset, 0, 100000),
      q: String(req.query.q || '').trim(),
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroups failed:', error);
    return res.status(500).json({ error: 'Failed to list knowledge groups' });
  }
});

router.post('/knowledge-groups', async (req, res) => {
  try {
    const group = await knowledgeGroupsService.createKnowledgeGroup(getUserId(req), req.body || {});
    return res.status(201).json({ group });
  } catch (error) {
    console.error('[ResearchOps] createKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create knowledge group') });
  }
});

router.patch('/knowledge-groups/:groupId', async (req, res) => {
  try {
    const group = await knowledgeGroupsService.updateKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.body || {}
    );
    if (!group) return res.status(404).json({ error: 'Knowledge group not found' });
    return res.json({ group });
  } catch (error) {
    console.error('[ResearchOps] updateKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update knowledge group') });
  }
});

router.delete('/knowledge-groups/:groupId', async (req, res) => {
  try {
    await knowledgeGroupsService.deleteKnowledgeGroup(getUserId(req), req.params.groupId);
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] deleteKnowledgeGroup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to delete knowledge group') });
  }
});

router.get('/knowledge-groups/:groupId/documents', async (req, res) => {
  try {
    const result = await knowledgeGroupsService.listKnowledgeGroupDocuments(
      getUserId(req),
      req.params.groupId,
      {
        limit: parseLimit(req.query.limit, 12, 100),
        offset: parseOffset(req.query.offset, 0, 100000),
        q: String(req.query.q || '').trim(),
      }
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroupDocuments failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list group documents') });
  }
});

router.post('/knowledge-groups/:groupId/documents', async (req, res) => {
  try {
    const docIds = Array.isArray(req.body?.documentIds) ? req.body.documentIds : [];
    const result = await knowledgeGroupsService.addDocumentsToKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      docIds
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] addDocumentsToKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to add documents to group') });
  }
});

router.delete('/knowledge-groups/:groupId/documents/:documentId', async (req, res) => {
  try {
    await knowledgeGroupsService.removeDocumentFromKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.params.documentId
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] removeDocumentFromKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to remove document from group') });
  }
});

// Knowledge assets (insights/files/notes/reports + document-backed assets)
router.get('/knowledge/assets', async (req, res) => {
  try {
    const result = await knowledgeAssetsService.listKnowledgeAssets(getUserId(req), {
      limit: parseLimit(req.query.limit, 20, 200),
      offset: parseOffset(req.query.offset, 0, 100000),
      q: String(req.query.q || '').trim(),
      assetType: String(req.query.assetType || '').trim(),
      provider: String(req.query.provider || '').trim(),
      groupId: req.query.groupId ? Number(req.query.groupId) : null,
      includeBody: req.query.includeBody === 'true',
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeAssets failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list knowledge assets') });
  }
});

router.post('/knowledge/assets', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.createKnowledgeAsset(getUserId(req), req.body || {});
    return res.status(201).json({ asset });
  } catch (error) {
    console.error('[ResearchOps] createKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create knowledge asset') });
  }
});

router.post('/knowledge/assets/upload', knowledgeAssetUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    const tagsParsed = parseMaybeJson(req.body?.tags, []);
    const metadataParsed = parseMaybeJson(req.body?.metadata, {});
    const sourceParsed = parseMaybeJson(req.body?.source, {});
    const groupIdsParsed = parseMaybeJson(req.body?.groupIds, []);
    const asset = await knowledgeAssetsService.createKnowledgeAssetFromUpload(
      getUserId(req),
      {
        assetType: req.body?.assetType,
        title: req.body?.title,
        summary: req.body?.summary,
        bodyMd: req.body?.bodyMd,
        source: sourceParsed || {},
        sourceProvider: req.body?.sourceProvider,
        sourceSessionId: req.body?.sourceSessionId,
        sourceMessageId: req.body?.sourceMessageId,
        sourceUrl: req.body?.sourceUrl,
        tags: Array.isArray(tagsParsed) ? tagsParsed : [],
        metadata: metadataParsed && typeof metadataParsed === 'object' ? metadataParsed : {},
        externalDocumentId: req.body?.externalDocumentId,
        groupIds: Array.isArray(groupIdsParsed) ? groupIdsParsed : [],
      },
      req.file
    );
    return res.status(201).json({ asset });
  } catch (error) {
    console.error('[ResearchOps] uploadKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to upload knowledge asset') });
  }
});

router.get('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.getKnowledgeAsset(getUserId(req), req.params.assetId, {
      includeBody: true,
    });
    if (!asset) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ asset });
  } catch (error) {
    console.error('[ResearchOps] getKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch knowledge asset') });
  }
});

router.patch('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const asset = await knowledgeAssetsService.updateKnowledgeAsset(getUserId(req), req.params.assetId, req.body || {});
    if (!asset) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ asset });
  } catch (error) {
    console.error('[ResearchOps] updateKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update knowledge asset') });
  }
});

router.delete('/knowledge/assets/:assetId', async (req, res) => {
  try {
    const deleted = await knowledgeAssetsService.deleteKnowledgeAsset(getUserId(req), req.params.assetId);
    if (!deleted) return res.status(404).json({ error: 'Knowledge asset not found' });
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] deleteKnowledgeAsset failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to delete knowledge asset') });
  }
});

router.get('/knowledge/groups/:groupId/assets', async (req, res) => {
  try {
    const result = await knowledgeAssetsService.listKnowledgeGroupAssets(
      getUserId(req),
      req.params.groupId,
      {
        limit: parseLimit(req.query.limit, 20, 200),
        offset: parseOffset(req.query.offset, 0, 100000),
        q: String(req.query.q || '').trim(),
        includeBody: req.query.includeBody === 'true',
      }
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listKnowledgeGroupAssets failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list group assets') });
  }
});

router.post('/knowledge/groups/:groupId/assets', async (req, res) => {
  try {
    const assetIds = Array.isArray(req.body?.assetIds) ? req.body.assetIds : [];
    const result = await knowledgeAssetsService.addAssetsToKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      assetIds
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] addAssetsToKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to add assets to group') });
  }
});

router.delete('/knowledge/groups/:groupId/assets/:assetId', async (req, res) => {
  try {
    await knowledgeAssetsService.removeAssetFromKnowledgeGroup(
      getUserId(req),
      req.params.groupId,
      req.params.assetId
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('[ResearchOps] removeAssetFromKnowledgeGroup failed:', error);
    if (error.code === 'GROUP_NOT_FOUND') return res.status(404).json({ error: 'Knowledge group not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to remove asset from group') });
  }
});

router.post('/runs/:runId/context-pack/preview', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    const run = await researchOpsStore.getRun(getUserId(req), runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const pack = await contextPackService.buildContextPack(getUserId(req), {
      runId: run.id,
      projectId: run.projectId,
      contextRefs: run.contextRefs || run.metadata?.contextRefs || req.body?.contextRefs || {},
      explicitAssetIds: req.body?.assetIds,
    });
    return res.json({ pack });
  } catch (error) {
    console.error('[ResearchOps] preview context-pack failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to preview context pack') });
  }
});

// Ideas
router.get('/ideas', async (req, res) => {
  try {
    const items = await researchOpsStore.listIdeas(getUserId(req), {
      projectId: String(req.query.projectId || '').trim(),
      status: String(req.query.status || '').trim().toUpperCase(),
      limit: parseLimit(req.query.limit, 80, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listIdeas failed:', error);
    res.status(500).json({ error: 'Failed to list ideas' });
  }
});

router.post('/ideas', async (req, res) => {
  try {
    const idea = await researchOpsStore.createIdea(getUserId(req), req.body || {});
    res.status(201).json({ idea });
  } catch (error) {
    console.error('[ResearchOps] createIdea failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to create idea') });
  }
});

router.get('/ideas/:ideaId', async (req, res) => {
  try {
    const idea = await researchOpsStore.getIdea(getUserId(req), req.params.ideaId);
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json({ idea });
  } catch (error) {
    console.error('[ResearchOps] getIdea failed:', error);
    res.status(500).json({ error: 'Failed to fetch idea' });
  }
});

router.patch('/ideas/:ideaId', async (req, res) => {
  try {
    const idea = await researchOpsStore.updateIdea(getUserId(req), req.params.ideaId, req.body || {});
    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    return res.json({ idea });
  } catch (error) {
    console.error('[ResearchOps] updateIdea failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update idea') });
  }
});

// Runs + Queue
router.post('/plan/generate', async (req, res) => {
  try {
    const instruction = String(req.body?.instruction || '').trim();
    const instructionType = String(req.body?.instructionType || '').trim();
    if (!instruction) {
      return res.status(400).json({ error: 'instruction is required' });
    }
    const plan = planAgentService.generatePlan({ instruction, instructionType });
    return res.json({ plan });
  } catch (error) {
    console.error('[ResearchOps] plan generate failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate plan') });
  }
});

router.post('/plan/enqueue-v2', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const instruction = String(body.instruction || '').trim();
    const projectId = String(body.projectId || '').trim();
    const runType = String(body.runType || 'AGENT').trim().toUpperCase() || 'AGENT';
    const serverId = String(body.serverId || '').trim() || 'local-default';
    const provider = String(body.provider || 'codex_cli').trim() || 'codex_cli';
    if (!instruction) return res.status(400).json({ error: 'instruction is required' });
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const plan = planAgentService.generatePlan({
      instruction,
      instructionType: String(body.instructionType || '').trim(),
    });
    const workflow = workflowSchemaService.normalizeAndValidateWorkflow(plan.workflow, { allowEmpty: false });

    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId,
      runType,
      provider,
      schemaVersion: '2.0',
      mode: String(body.mode || 'headless').trim().toLowerCase() === 'interactive' ? 'interactive' : 'headless',
      workflow,
      contextRefs: body.contextRefs && typeof body.contextRefs === 'object' ? body.contextRefs : {},
      outputContract: body.outputContract && typeof body.outputContract === 'object'
        ? body.outputContract
        : {},
      budgets: body.budgets && typeof body.budgets === 'object' ? body.budgets : {},
      hitlPolicy: body.hitlPolicy && typeof body.hitlPolicy === 'object' ? body.hitlPolicy : {},
      metadata: {
        ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
        plan: {
          planId: plan.plan_id,
          instructionType: plan.instruction_type,
          resourceEstimate: plan.resource_estimate,
          riskNotes: plan.risk_notes,
        },
      },
    });
    return res.status(201).json({ plan, run });
  } catch (error) {
    console.error('[ResearchOps] plan enqueue-v2 failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate and enqueue plan') });
  }
});

router.post('/runs/enqueue-v2', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const runPayload = body.run && typeof body.run === 'object' ? body.run : body;
    const projectId = String(runPayload.projectId || '').trim();
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const mode = String(runPayload.mode || 'headless').trim().toLowerCase();
    const workflowInput = Array.isArray(runPayload.workflow) ? runPayload.workflow : [];
    const workflow = workflowSchemaService.normalizeAndValidateWorkflow(workflowInput, {
      allowEmpty: true,
    });

    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId: String(runPayload.serverId || '').trim() || 'local-default',
      runType: String(runPayload.runType || 'AGENT').trim().toUpperCase() || 'AGENT',
      provider: String(runPayload.provider || 'codex_cli').trim() || 'codex_cli',
      schemaVersion: '2.0',
      mode: mode === 'interactive' ? 'interactive' : 'headless',
      workflow,
      skillRefs: Array.isArray(runPayload.skillRefs) ? runPayload.skillRefs : [],
      contextRefs: runPayload.contextRefs && typeof runPayload.contextRefs === 'object'
        ? runPayload.contextRefs
        : {},
      outputContract: runPayload.outputContract && typeof runPayload.outputContract === 'object'
        ? runPayload.outputContract
        : {},
      budgets: runPayload.budgets && typeof runPayload.budgets === 'object'
        ? runPayload.budgets
        : {},
      hitlPolicy: runPayload.hitlPolicy && typeof runPayload.hitlPolicy === 'object'
        ? runPayload.hitlPolicy
        : {},
      metadata: runPayload.metadata && typeof runPayload.metadata === 'object'
        ? runPayload.metadata
        : {},
    });
    return res.status(201).json({ run });
  } catch (error) {
    console.error('[ResearchOps] enqueueRunV2 failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to enqueue v2 run') });
  }
});

router.post('/runs/enqueue', async (req, res) => {
  try {
    const run = await researchOpsStore.enqueueRun(getUserId(req), req.body || {});
    res.status(201).json({ run });
  } catch (error) {
    console.error('[ResearchOps] enqueueRun failed:', error);
    if (error.code === 'PROJECT_NOT_FOUND') {
      return res.status(404).json({ error: 'projectId does not exist' });
    }
    return res.status(400).json({ error: sanitizeError(error, 'Failed to enqueue run') });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const items = await researchOpsStore.listRuns(getUserId(req), {
      projectId: String(req.query.projectId || '').trim(),
      status: String(req.query.status || '').trim().toUpperCase(),
      limit: parseLimit(req.query.limit, 80, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listRuns failed:', error);
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] getRun failed:', error);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

router.post('/runs/:runId/status', async (req, res) => {
  try {
    const run = await researchOpsStore.updateRunStatus(
      getUserId(req),
      req.params.runId,
      req.body?.status,
      req.body?.message,
      req.body?.payload
    );
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] updateRunStatus failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update run status') });
  }
});

router.post('/runs/:runId/cancel', async (req, res) => {
  try {
    const run = await researchOpsRunner.cancelRun(getUserId(req), req.params.runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] cancelRun failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to cancel run') });
  }
});

router.post('/runs/:runId/retry', async (req, res) => {
  try {
    const run = await researchOpsStore.retryRun(getUserId(req), req.params.runId, {
      reason: req.body?.reason,
    });
    return res.status(201).json({ run });
  } catch (error) {
    console.error('[ResearchOps] retryRun failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to retry run') });
  }
});

router.post('/runs/:runId/workflow/insert', async (req, res) => {
  try {
    const run = await researchOpsStore.insertRunWorkflowStep(getUserId(req), req.params.runId, {
      step: req.body?.step,
      afterStepId: req.body?.afterStepId,
      beforeStepId: req.body?.beforeStepId,
      index: req.body?.index,
    });
    return res.json({ run });
  } catch (error) {
    console.error('[ResearchOps] insertRunWorkflowStep failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to insert workflow step') });
  }
});

router.post('/runs/:runId/events', async (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    if (!events.length) return res.status(400).json({ error: 'events must be a non-empty array' });
    const items = await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, events);
    return res.status(201).json({ count: items.length, items });
  } catch (error) {
    console.error('[ResearchOps] publishRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to publish run events') });
  }
});

router.get('/runs/:runId/events', async (req, res) => {
  try {
    const result = await researchOpsStore.listRunEvents(getUserId(req), req.params.runId, {
      afterSequence: req.query.afterSequence,
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listRunEvents failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run events') });
  }
});

router.get('/runs/:runId/steps', async (req, res) => {
  try {
    const items = await researchOpsStore.listRunSteps(getUserId(req), req.params.runId);
    return res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listRunSteps failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run steps') });
  }
});

router.get('/runs/:runId/artifacts', async (req, res) => {
  try {
    const items = await researchOpsStore.listRunArtifacts(getUserId(req), req.params.runId, {
      kind: String(req.query.kind || '').trim(),
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listRunArtifacts failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run artifacts') });
  }
});

router.get('/runs/:runId/checkpoints', async (req, res) => {
  try {
    const items = await researchOpsStore.listRunCheckpoints(getUserId(req), req.params.runId, {
      status: String(req.query.status || '').trim(),
      limit: parseLimit(req.query.limit, 200, 1000),
    });
    return res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listRunCheckpoints failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list run checkpoints') });
  }
});

router.post('/runs/:runId/checkpoints/:checkpointId/decision', async (req, res) => {
  try {
    const requestedDecision = String(req.body?.decision || '').trim().toUpperCase();
    const normalizedDecision = requestedDecision === 'EDITED' ? 'EDIT' : requestedDecision;
    const checkpoint = await researchOpsStore.decideRunCheckpoint(
      getUserId(req),
      req.params.runId,
      req.params.checkpointId,
      {
        decision: normalizedDecision,
        note: req.body?.note,
        edits: req.body?.edits,
        decidedBy: req.userId || 'czk',
      }
    );
    if (!checkpoint) return res.status(404).json({ error: 'Checkpoint not found' });

    await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, [{
      eventType: 'CHECKPOINT_DECIDED',
      status: checkpoint.status,
      message: `Checkpoint ${checkpoint.id} ${checkpoint.status.toLowerCase()}`,
      payload: {
        checkpointId: checkpoint.id,
        decision: checkpoint.decision || null,
      },
    }]);
    await researchOpsStore.publishRunEvents(getUserId(req), req.params.runId, [{
      eventType: 'REVIEW_ACTION',
      status: checkpoint.status,
      message: `Review action ${normalizedDecision || 'UNKNOWN'} for checkpoint ${checkpoint.id}`,
      payload: {
        checkpointId: checkpoint.id,
        action: normalizedDecision || null,
        note: req.body?.note || null,
        edits: req.body?.edits && typeof req.body.edits === 'object' ? req.body.edits : null,
        decidedBy: req.userId || 'czk',
      },
    }]);

    if (checkpoint.status === 'REJECTED') {
      const run = await researchOpsStore.getRun(getUserId(req), req.params.runId);
      if (run?.status === 'RUNNING') {
        await researchOpsStore.updateRunStatus(
          getUserId(req),
          req.params.runId,
          'FAILED',
          `Checkpoint ${checkpoint.id} rejected`
        ).catch(() => {});
      }
    }

    return res.json({ checkpoint });
  } catch (error) {
    console.error('[ResearchOps] decideRunCheckpoint failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to decide checkpoint') });
  }
});

router.get('/runs/:runId/report', async (req, res) => {
  try {
    const userId = getUserId(req);
    const runId = String(req.params.runId || '').trim();
    const [run, steps, artifacts, checkpoints] = await Promise.all([
      researchOpsStore.getRun(userId, runId),
      researchOpsStore.listRunSteps(userId, runId),
      researchOpsStore.listRunArtifacts(userId, runId, { limit: 1000 }),
      researchOpsStore.listRunCheckpoints(userId, runId, { limit: 500 }),
    ]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const includeInline = req.query.inline === 'true';
    let summaryText = null;
    let manifest = null;
    const summaryArtifact = artifacts.find((item) => item.kind === 'run_summary_md') || null;
    const manifestArtifact = artifacts.find((item) => item.kind === 'result_manifest') || null;
    if (includeInline) {
      if (summaryArtifact?.objectKey) {
        const buffer = await s3Service.downloadBuffer(summaryArtifact.objectKey).catch(() => null);
        summaryText = buffer ? buffer.toString('utf8') : null;
      } else {
        summaryText = summaryArtifact?.metadata?.inlinePreview || null;
      }
      if (manifestArtifact?.objectKey) {
        const buffer = await s3Service.downloadBuffer(manifestArtifact.objectKey).catch(() => null);
        if (buffer) {
          try {
            manifest = JSON.parse(buffer.toString('utf8'));
          } catch (_) {
            manifest = null;
          }
        }
      } else {
        const preview = manifestArtifact?.metadata?.inlinePreview;
        if (preview) {
          try {
            manifest = JSON.parse(preview);
          } catch (_) {
            manifest = null;
          }
        }
      }
    }

    return res.json({
      run,
      steps,
      artifacts,
      checkpoints,
      summary: summaryText,
      manifest,
    });
  } catch (error) {
    console.error('[ResearchOps] getRunReport failed:', error);
    if (error.code === 'RUN_NOT_FOUND') return res.status(404).json({ error: 'Run not found' });
    return res.status(400).json({ error: sanitizeError(error, 'Failed to fetch run report') });
  }
});

router.get('/scheduler/queue', async (req, res) => {
  try {
    const items = await researchOpsStore.listQueue(getUserId(req), {
      serverId: String(req.query.serverId || '').trim(),
      limit: parseLimit(req.query.limit, 100, 300),
    });
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listQueue failed:', error);
    res.status(500).json({ error: 'Failed to list queue' });
  }
});

router.post('/scheduler/lease-next', async (req, res) => {
  try {
    const leased = await researchOpsStore.leaseNextRun(getUserId(req), {
      serverId: String(req.body?.serverId || '').trim(),
    });
    return res.json(leased);
  } catch (error) {
    console.error('[ResearchOps] leaseNext failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease run') });
  }
});

router.post('/scheduler/lease-and-execute', async (req, res) => {
  try {
    const result = await researchOpsRunner.leaseAndExecuteNext(
      getUserId(req),
      String(req.body?.serverId || '').trim() || 'local-default'
    );
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] leaseAndExecute failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to lease and execute') });
  }
});

router.post('/scheduler/recover-stale', async (req, res) => {
  try {
    const result = await researchOpsStore.recoverStaleRuns(getUserId(req), {
      minutesStale: req.body?.minutesStale,
      serverId: String(req.body?.serverId || '').trim(),
      dryRun: req.body?.dryRun === true,
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] recoverStale failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to recover stale runs') });
  }
});

router.get('/runner/running', (req, res) => {
  res.json({ items: researchOpsRunner.getRunningState() });
});

// Daemons
router.post('/daemons/register', async (req, res) => {
  try {
    const daemon = await researchOpsStore.registerDaemon(getUserId(req), req.body || {});
    return res.status(201).json({
      serverId: daemon.id,
      hostname: daemon.hostname,
      status: daemon.status,
      heartbeatAt: daemon.heartbeatAt,
    });
  } catch (error) {
    console.error('[ResearchOps] registerDaemon failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to register daemon') });
  }
});

router.post('/daemons/heartbeat', async (req, res) => {
  try {
    const daemon = await researchOpsStore.heartbeatDaemon(getUserId(req), req.body || {});
    if (!daemon) return res.status(404).json({ error: 'Server not found for heartbeat' });
    return res.json({
      serverId: daemon.id,
      hostname: daemon.hostname,
      status: daemon.status,
      heartbeatAt: daemon.heartbeatAt,
    });
  } catch (error) {
    console.error('[ResearchOps] heartbeatDaemon failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to update heartbeat') });
  }
});

router.get('/daemons', async (req, res) => {
  try {
    const items = await researchOpsStore.listDaemons(getUserId(req), {
      limit: parseLimit(req.query.limit, 100, 300),
    });
    return res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listDaemons failed:', error);
    return res.status(500).json({ error: 'Failed to list daemons' });
  }
});

router.get('/cluster/resource-pool', async (req, res) => {
  try {
    const userId = getUserId(req);
    const staleAfterSec = Number(req.query.staleAfterSec);
    const staleAfterMs = Number.isFinite(staleAfterSec) && staleAfterSec > 0
      ? Math.floor(staleAfterSec * 1000)
      : 90 * 1000;
    const [daemons, queuedRuns, runningRuns, provisioningRuns] = await Promise.all([
      researchOpsStore.listDaemons(userId, { limit: 500 }),
      researchOpsStore.listQueue(userId, { limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'RUNNING', limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'PROVISIONING', limit: 1000 }),
    ]);
    const activeRuns = [...runningRuns, ...provisioningRuns];
    const queueByServer = new Map();
    queuedRuns.forEach((run) => {
      const sid = String(run.serverId || '').trim() || 'local-default';
      queueByServer.set(sid, (queueByServer.get(sid) || 0) + 1);
    });
    const activeByServer = new Map();
    activeRuns.forEach((run) => {
      const sid = String(run.serverId || '').trim() || 'local-default';
      activeByServer.set(sid, (activeByServer.get(sid) || 0) + 1);
    });

    const servers = daemons.map((daemon) => {
      const status = deriveDaemonStatus(daemon, { staleAfterMs });
      const gpu = extractGpuCapacity(daemon.capacity);
      const cpuMemory = extractCpuMemoryCapacity(daemon.capacity);
      const serverId = String(daemon.id || '');
      return {
        serverId,
        hostname: daemon.hostname,
        status,
        labels: daemon.labels || {},
        heartbeatAt: daemon.heartbeatAt || null,
        concurrencyLimit: Number(daemon.concurrencyLimit) || 1,
        queuedRuns: queueByServer.get(serverId) || 0,
        activeRuns: activeByServer.get(serverId) || 0,
        resources: {
          gpu,
          cpuMemoryGb: cpuMemory,
        },
      };
    });

    const aggregate = servers.reduce((acc, item) => {
      if (item.status === 'ONLINE' || item.status === 'DRAINING') {
        acc.gpuTotal += item.resources.gpu.total;
        acc.gpuAvailable += item.resources.gpu.available;
        acc.cpuMemoryTotalGb += item.resources.cpuMemoryGb.total;
        acc.cpuMemoryAvailableGb += item.resources.cpuMemoryGb.available;
      }
      acc.queueDepth += item.queuedRuns;
      acc.activeRuns += item.activeRuns;
      if (item.status === 'ONLINE') acc.onlineServers += 1;
      if (item.status === 'OFFLINE') acc.offlineServers += 1;
      if (item.status === 'DRAINING') acc.drainingServers += 1;
      return acc;
    }, {
      gpuTotal: 0,
      gpuAvailable: 0,
      cpuMemoryTotalGb: 0,
      cpuMemoryAvailableGb: 0,
      queueDepth: 0,
      activeRuns: 0,
      onlineServers: 0,
      offlineServers: 0,
      drainingServers: 0,
    });

    return res.json({
      aggregate,
      servers,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] cluster resource-pool failed:', error);
    return res.status(500).json({ error: 'Failed to load cluster resource pool' });
  }
});

router.get('/cluster/agent-capacity', async (req, res) => {
  try {
    const userId = getUserId(req);
    const [runningRuns, provisioningRuns] = await Promise.all([
      researchOpsStore.listRuns(userId, { status: 'RUNNING', limit: 1000 }),
      researchOpsStore.listRuns(userId, { status: 'PROVISIONING', limit: 1000 }),
    ]);
    const { defaultLimit, parsed } = parseProviderConcurrencyLimits();
    const allRuns = [...runningRuns, ...provisioningRuns].filter((run) => run.runType === 'AGENT');
    const activeByProvider = new Map();
    allRuns.forEach((run) => {
      const provider = String(run.provider || 'codex_cli').trim() || 'codex_cli';
      activeByProvider.set(provider, (activeByProvider.get(provider) || 0) + 1);
    });

    const providerKeys = new Set([
      ...Object.keys(parsed),
      ...Array.from(activeByProvider.keys()),
      'codex_cli',
      'claude_code_cli',
      'gemini_cli',
    ]);
    const providers = Array.from(providerKeys).sort().map((provider) => {
      const active = activeByProvider.get(provider) || 0;
      const maxConcurrent = parsed[provider] || defaultLimit;
      return {
        provider,
        activeSessions: active,
        maxConcurrent,
        availableSessions: Math.max(maxConcurrent - active, 0),
      };
    });

    const totals = providers.reduce((acc, item) => {
      acc.activeSessions += item.activeSessions;
      acc.maxConcurrent += item.maxConcurrent;
      acc.availableSessions += item.availableSessions;
      return acc;
    }, {
      activeSessions: 0,
      maxConcurrent: 0,
      availableSessions: 0,
    });

    return res.json({
      totals,
      providers,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] cluster agent-capacity failed:', error);
    return res.status(500).json({ error: 'Failed to load agent capacity' });
  }
});

// Skills
router.get('/skills', async (req, res) => {
  try {
    const items = await researchOpsStore.listSkills(getUserId(req));
    res.json({ items });
  } catch (error) {
    console.error('[ResearchOps] listSkills failed:', error);
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

router.post('/skills/sync', async (req, res) => {
  try {
    const result = await researchOpsStore.syncLocalSkillsToRemote(getUserId(req));
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] syncLocalSkillsToRemote failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to sync skills to object storage') });
  }
});

// KB bridge
router.post('/kb/search', async (req, res) => {
  const kbServiceUrl = String(process.env.KB_SERVICE_URL || '').trim();
  const query = String(req.body?.query || '').trim();
  const topK = parseLimit(req.body?.topK, 5, 30);

  if (!query) {
    return res.status(400).json({ error: 'query is required' });
  }

  if (kbServiceUrl) {
    try {
      const result = await withTimeout(
        async (signal) => {
          const response = await fetch(`${kbServiceUrl.replace(/\/$/, '')}/v1/kb/search`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, top_k: topK }),
            signal,
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`KB service ${response.status}: ${text}`);
          return JSON.parse(text);
        },
        12000
      );
      return res.json(result);
    } catch (error) {
      console.error('[ResearchOps] KB proxy failed:', error);
      return res.status(502).json({ error: sanitizeError(error, 'KB service unavailable') });
    }
  }

  // Lightweight fallback over ideas/projects metadata.
  try {
    const [ideas, projects] = await Promise.all([
      researchOpsStore.listIdeas(getUserId(req), { limit: 200 }),
      researchOpsStore.listProjects(getUserId(req), { limit: 200 }),
    ]);

    const q = query.toLowerCase();
    const ideaHits = ideas
      .filter((idea) =>
        `${idea.title}\n${idea.hypothesis}\n${idea.summary || ''}`.toLowerCase().includes(q)
      )
      .slice(0, topK)
      .map((idea) => ({
        kind: 'idea',
        id: idea.id,
        title: idea.title,
        text: idea.hypothesis,
      }));

    const projectHits = projects
      .filter((project) =>
        `${project.name}\n${project.description || ''}`.toLowerCase().includes(q)
      )
      .slice(0, Math.max(0, topK - ideaHits.length))
      .map((project) => ({
        kind: 'project',
        id: project.id,
        title: project.name,
        text: project.description || '',
      }));

    return res.json({
      source: 'fallback-metadata',
      items: [...ideaHits, ...projectHits],
    });
  } catch (error) {
    console.error('[ResearchOps] KB fallback failed:', error);
    return res.status(500).json({ error: 'Failed to perform fallback KB search' });
  }
});

// Experiment runner bridge
router.post('/experiments/execute', async (req, res) => {
  const experimentRunnerUrl = String(process.env.EXPERIMENT_RUNNER_URL || '').trim();
  const projectId = String(req.body?.projectId || '').trim();
  const serverId = String(req.body?.serverId || '').trim() || 'local-default';
  const command = String(req.body?.command || '').trim();
  const args = Array.isArray(req.body?.args) ? req.body.args : [];

  if (!projectId || !command) {
    return res.status(400).json({ error: 'projectId and command are required' });
  }

  if (experimentRunnerUrl) {
    try {
      const result = await withTimeout(
        async (signal) => {
          const response = await fetch(`${experimentRunnerUrl.replace(/\/$/, '')}/v1/experiments/execute`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(req.body || {}),
            signal,
          });
          const text = await response.text();
          if (!response.ok) throw new Error(`Experiment service ${response.status}: ${text}`);
          return JSON.parse(text);
        },
        20000
      );
      return res.json(result);
    } catch (error) {
      console.error('[ResearchOps] Experiment proxy failed:', error);
      return res.status(502).json({ error: sanitizeError(error, 'Experiment service unavailable') });
    }
  }

  try {
    const run = await researchOpsStore.enqueueRun(getUserId(req), {
      projectId,
      serverId,
      runType: 'EXPERIMENT',
      metadata: {
        command,
        args,
        cwd: String(req.body?.cwd || '').trim() || undefined,
        timeoutMs: Number(req.body?.timeoutMs) > 0 ? Number(req.body.timeoutMs) : undefined,
      },
    });

    await researchOpsRunner.executeRun(getUserId(req), run);

    return res.status(202).json({
      mode: 'local-backend-runner',
      run,
    });
  } catch (error) {
    console.error('[ResearchOps] Local experiment execution failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to execute experiment') });
  }
});

module.exports = router;
