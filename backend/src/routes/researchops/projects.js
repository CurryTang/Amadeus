'use strict';

const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const config = require('../../config');
const { getDb } = require('../../db');
const s3Service = require('../../services/s3.service');
const codexCliService = require('../../services/codex-cli.service');
const geminiCliService = require('../../services/gemini-cli.service');
const llmService = require('../../services/llm.service');
const researchOpsStore = require('../../services/researchops/store');
const researchOpsRunner = require('../../services/researchops/runner');
const autopilotService = require('../../services/researchops/autopilot.service');
const knowledgeGroupsService = require('../../services/knowledge-groups.service');
const contextPackService = require('../../services/researchops/context-pack.service');
const projectInsightsProxy = require('../../services/project-insights-proxy.service');
const projectInsightsService = require('../../services/project-insights.service');
const planAgentService = require('../../services/researchops/plan-agent.service');
const interactiveAgentService = require('../../services/researchops/interactive-agent.service');
const treePlanService = require('../../services/researchops/tree-plan.service');
const treeStateService = require('../../services/researchops/tree-state.service');
const searchExecutorService = require('../../services/researchops/search-executor.service');
const contextRouterService = require('../../services/researchops/context-router.service');
const repoMapService = require('../../services/researchops/repo-map.service');
const failureSignatureService = require('../../services/researchops/failure-signature.service');
const deliverableReportSkillService = require('../../services/researchops/deliverable-report-skill.service');
const codebaseAchievementService = require('../../services/researchops/codebase-achievement.service');
const todoGeneratorService = require('../../services/researchops/todo-generator.service');
const {
  buildResearchOpsSshArgs,
  classifySshError,
} = require('../../services/ssh-auth.service');
const {
  parseLimit, parseOffset, parseBoolean, cleanString,
  getUserId, sanitizeError, parseMaybeJson, expandHome,
} = require('./shared');

const proposalUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

const agentSessionImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

function toErrorPayload(error, fallback = 'Request failed') {
  const code = String(error?.code || '').trim();
  const message = sanitizeError(error, fallback);
  if (!code) {
    const mapped = classifySshError(error);
    if (mapped?.code) {
      if (mapped.code === 'SSH_COMMAND_FAILED') {
        const lower = String(message || '').toLowerCase();
        if (
          lower.includes('connection closed')
          || lower.includes('broken pipe')
          || lower.includes('kex_exchange_identification')
        ) {
          return { code: 'SSH_HOST_UNREACHABLE', error: message };
        }
      }
      return { code: mapped.code, error: mapped.message || message };
    }
    if (typeof message === 'string' && message.toLowerCase().includes('permission denied')) {
      return { code: 'SSH_AUTH_FAILED', error: message };
    }
    if (
      typeof message === 'string'
      && (
        message.toLowerCase().includes('connection refused')
        || message.toLowerCase().includes('no route to host')
        || message.toLowerCase().includes('network is unreachable')
      )
    ) {
      return { code: 'SSH_HOST_UNREACHABLE', error: message };
    }
    return { error: message };
  }
  return { code, error: message };
}

function mapSshLikeError(error) {
  if (error?.code && String(error.code).startsWith('SSH_')) return error;
  const mapped = classifySshError(error);
  const wrapped = new Error(mapped.message || sanitizeError(error, 'SSH command failed'));
  wrapped.code = mapped.code || 'SSH_COMMAND_FAILED';
  return wrapped;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
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

function promiseWithTimeout(promise, timeoutMs = 30000, label = 'Operation') {
  const limit = Number(timeoutMs);
  if (!Number.isFinite(limit) || limit <= 0) return promise;
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${limit}ms`));
    }, limit);
    if (typeof timer?.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
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
const CHATDSE_ENFORCED_HOST = 'compute.example.edu';
const CHATDSE_PROJECT_ROOT = '/egr/research-dselab/testuser';
const ACTIVE_PROJECT_RUN_STATUSES = ['PROVISIONING', 'RUNNING'];

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
  return buildResearchOpsSshArgs(server, { connectTimeout });
}

async function getSshServerById(serverId) {
  const sid = String(serverId || '').trim();
  if (!sid) return null;
  const db = getDb();
  let result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE id = ?`,
    args: [sid],
  });
  if (result.rows?.[0]) return result.rows[0];
  result = await db.execute({
    sql: `SELECT * FROM ssh_servers WHERE name = ?`,
    args: [sid],
  });
  return result.rows?.[0] || null;
}

function normalizePosixPathForPolicy(inputPath = '') {
  const raw = String(inputPath || '').trim();
  if (!raw) return '';
  const normalized = path.posix.normalize(raw.startsWith('/') ? raw : `/${raw}`);
  return normalized === '/' ? normalized : normalized.replace(/\/+$/, '');
}

function isPathWithinBase(targetPath = '', basePath = '') {
  const target = normalizePosixPathForPolicy(targetPath);
  const base = normalizePosixPathForPolicy(basePath);
  if (!target || !base) return false;
  return target === base || target.startsWith(`${base}/`);
}

function enforceSshProjectPathPolicy(server = null, projectPath = '') {
  const host = String(server?.host || '').trim().toLowerCase();
  if (host !== CHATDSE_ENFORCED_HOST) return;
  if (!isPathWithinBase(projectPath, CHATDSE_PROJECT_ROOT)) {
    throw new Error(`For ${CHATDSE_ENFORCED_HOST}, projectPath must be under ${CHATDSE_PROJECT_ROOT}`);
  }
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

async function enforceExperimentProjectPathPolicy(userId, projectId, runType = '') {
  if (String(runType || '').trim().toUpperCase() !== 'EXPERIMENT') return;
  const { project, server } = await resolveProjectContext(userId, projectId);
  if (String(project.locationType || '').toLowerCase() !== 'ssh') return;
  enforceSshProjectPathPolicy(server, project.projectPath);
}


function resolveRecommendedVenvTool({
  hasPixiDir = false,
  hasUvDir = false,
  hasPixiToml = false,
  hasUvLock = false,
} = {}) {
  if (hasPixiDir) return 'pixi';
  if (hasUvDir) return 'uv';
  if (hasPixiToml) return 'pixi';
  if (hasUvLock) return 'uv';
  return 'pixi';
}

async function detectLocalProjectVenvStatus(projectPath) {
  const rootPath = path.resolve(expandHome(String(projectPath || '').trim()));
  const stat = await fs.stat(rootPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${rootPath}`);
  }

  const pixiDirStat = await fs.stat(path.join(rootPath, '.pixi')).catch(() => null);
  const uvDirStat = await fs.stat(path.join(rootPath, '.uv')).catch(() => null);
  const pixiTomlStat = await fs.stat(path.join(rootPath, 'pixi.toml')).catch(() => null);
  const uvLockStat = await fs.stat(path.join(rootPath, 'uv.lock')).catch(() => null);
  const hasPixiDir = Boolean(pixiDirStat?.isDirectory());
  const hasUvDir = Boolean(uvDirStat?.isDirectory());
  const hasPixiToml = Boolean(pixiTomlStat?.isFile());
  const hasUvLock = Boolean(uvLockStat?.isFile());

  const availabilityRaw = await runCommand(
    'bash',
    [
      '-lc',
      'command -v pixi >/dev/null 2>&1 && echo "__PIXIBIN__:1" || echo "__PIXIBIN__:0"; command -v uv >/dev/null 2>&1 && echo "__UVBIN__:1" || echo "__UVBIN__:0"',
    ],
    { timeoutMs: 8000 }
  ).catch(() => ({ stdout: '__PIXIBIN__:0\n__UVBIN__:0\n' }));
  const lines = String(availabilityRaw.stdout || '').split(/\r?\n/);
  const pixiAvailable = lines.some((line) => line.trim() === '__PIXIBIN__:1');
  const uvAvailable = lines.some((line) => line.trim() === '__UVBIN__:1');
  const activeTool = hasPixiDir ? 'pixi' : (hasUvDir ? 'uv' : null);

  return {
    rootPath,
    configured: Boolean(activeTool),
    activeTool,
    recommendedTool: resolveRecommendedVenvTool({
      hasPixiDir,
      hasUvDir,
      hasPixiToml,
      hasUvLock,
    }),
    markers: {
      pixiDir: hasPixiDir,
      uvDir: hasUvDir,
      pixiToml: hasPixiToml,
      uvLock: hasUvLock,
    },
    toolAvailability: {
      pixi: pixiAvailable,
      uv: uvAvailable,
    },
  };
}

async function detectSshProjectVenvStatus(server, projectPath) {
  const rootPath = String(projectPath || '').trim();
  const script = [
    'root="$1"',
    'if [ ! -d "$root" ]; then',
    '  echo "__NOT_DIR__:$root"',
    '  exit 0',
    'fi',
    'echo "__ROOT__:$root"',
    '[ -d "$root/.pixi" ] && echo "__PIXIDIR__:1" || echo "__PIXIDIR__:0"',
    '[ -d "$root/.uv" ] && echo "__UVDIR__:1" || echo "__UVDIR__:0"',
    '[ -f "$root/pixi.toml" ] && echo "__PIXITOML__:1" || echo "__PIXITOML__:0"',
    '[ -f "$root/uv.lock" ] && echo "__UVLOCK__:1" || echo "__UVLOCK__:0"',
    'command -v pixi >/dev/null 2>&1 && echo "__PIXIBIN__:1" || echo "__PIXIBIN__:0"',
    'command -v uv >/dev/null 2>&1 && echo "__UVBIN__:1" || echo "__UVBIN__:0"',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [rootPath], 20000);
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const notDirLine = lines.find((line) => line.startsWith('__NOT_DIR__:'));
  if (notDirLine) {
    throw new Error(`Project path is not a directory: ${notDirLine.slice('__NOT_DIR__:'.length)}`);
  }
  const hasPixiDir = lines.some((line) => line === '__PIXIDIR__:1');
  const hasUvDir = lines.some((line) => line === '__UVDIR__:1');
  const hasPixiToml = lines.some((line) => line === '__PIXITOML__:1');
  const hasUvLock = lines.some((line) => line === '__UVLOCK__:1');
  const pixiAvailable = lines.some((line) => line === '__PIXIBIN__:1');
  const uvAvailable = lines.some((line) => line === '__UVBIN__:1');
  const activeTool = hasPixiDir ? 'pixi' : (hasUvDir ? 'uv' : null);

  return {
    rootPath,
    configured: Boolean(activeTool),
    activeTool,
    recommendedTool: resolveRecommendedVenvTool({
      hasPixiDir,
      hasUvDir,
      hasPixiToml,
      hasUvLock,
    }),
    markers: {
      pixiDir: hasPixiDir,
      uvDir: hasUvDir,
      pixiToml: hasPixiToml,
      uvLock: hasUvLock,
    },
    toolAvailability: {
      pixi: pixiAvailable,
      uv: uvAvailable,
    },
  };
}

async function detectProjectVenvStatus(project, server) {
  if (project.locationType === 'ssh') {
    return detectSshProjectVenvStatus(server, project.projectPath);
  }
  return detectLocalProjectVenvStatus(project.projectPath);
}

async function setupLocalProjectVenv(projectPath, tool = 'pixi') {
  const selectedTool = String(tool || '').trim().toLowerCase() === 'uv' ? 'uv' : 'pixi';
  const rootPath = path.resolve(expandHome(String(projectPath || '').trim()));
  const stat = await fs.stat(rootPath).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Project path is not a directory: ${rootPath}`);
  }

  const script = selectedTool === 'uv'
    ? [
      'set -e',
      'root="$1"',
      'cd "$root"',
      'if ! command -v uv >/dev/null 2>&1; then',
      '  echo "__ERROR__:uv is not installed on this host"',
      '  exit 0',
      'fi',
      'if [ ! -d ".uv" ]; then',
      '  uv venv .uv',
      'fi',
      '[ -d ".uv" ] && echo "__OK__:uv" || echo "__ERROR__:failed to create .uv"',
    ].join('\n')
    : [
      'set -e',
      'root="$1"',
      'cd "$root"',
      'if ! command -v pixi >/dev/null 2>&1; then',
      '  echo "__ERROR__:pixi is not installed on this host"',
      '  exit 0',
      'fi',
      'if [ ! -f "pixi.toml" ]; then',
      '  pixi init',
      'fi',
      'pixi install',
      '[ -d ".pixi" ] && echo "__OK__:pixi" || echo "__ERROR__:failed to create .pixi"',
    ].join('\n');

  const { stdout } = await runCommand('bash', ['-s', '--', rootPath], {
    timeoutMs: 240000,
    input: `${script}\n`,
  });
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => line.startsWith('__ERROR__:'));
  if (errorLine) {
    throw new Error(errorLine.slice('__ERROR__:'.length) || 'Failed to set up virtual environment');
  }
  return { tool: selectedTool, rootPath };
}

async function setupSshProjectVenv(server, projectPath, tool = 'pixi') {
  const selectedTool = String(tool || '').trim().toLowerCase() === 'uv' ? 'uv' : 'pixi';
  const rootPath = String(projectPath || '').trim();
  const script = selectedTool === 'uv'
    ? [
      'set -e',
      'root="$1"',
      'if [ ! -d "$root" ]; then',
      '  echo "__ERROR__:project path is not a directory"',
      '  exit 0',
      'fi',
      'cd "$root"',
      'if ! command -v uv >/dev/null 2>&1; then',
      '  echo "__ERROR__:uv is not installed on remote host"',
      '  exit 0',
      'fi',
      'if [ ! -d ".uv" ]; then',
      '  uv venv .uv',
      'fi',
      '[ -d ".uv" ] && echo "__OK__:uv" || echo "__ERROR__:failed to create .uv"',
    ].join('\n')
    : [
      'set -e',
      'root="$1"',
      'if [ ! -d "$root" ]; then',
      '  echo "__ERROR__:project path is not a directory"',
      '  exit 0',
      'fi',
      'cd "$root"',
      'if ! command -v pixi >/dev/null 2>&1; then',
      '  echo "__ERROR__:pixi is not installed on remote host"',
      '  exit 0',
      'fi',
      'if [ ! -f "pixi.toml" ]; then',
      '  pixi init',
      'fi',
      'pixi install',
      '[ -d ".pixi" ] && echo "__OK__:pixi" || echo "__ERROR__:failed to create .pixi"',
    ].join('\n');

  const { stdout } = await runSshScript(server, script, [rootPath], 300000);
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const errorLine = lines.find((line) => line.startsWith('__ERROR__:'));
  if (errorLine) {
    throw new Error(errorLine.slice('__ERROR__:'.length) || 'Failed to set up virtual environment');
  }
  return { tool: selectedTool, rootPath };
}

async function setupProjectVenv(project, server, tool = 'pixi') {
  if (project.locationType === 'ssh') {
    return setupSshProjectVenv(server, project.projectPath, tool);
  }
  return setupLocalProjectVenv(project.projectPath, tool);
}

async function loadLocalProjectGitProgress(projectPath, limit, { branch = '' } = {}) {
  return projectInsightsService.loadLocalProjectGitProgress(projectPath, limit, { branch });
}

async function loadSshProjectGitProgress(server, projectPath, limit, { branch: branchOverride = '' } = {}) {
  const target = String(projectPath || '').trim();
  const overrideTrimmed = String(branchOverride || '').trim();
  const args = buildSshArgs(server, { connectTimeout: 15 });
  const branchInit = overrideTrimmed
    ? `branch="${overrideTrimmed.replace(/"/g, '')}"`
    : 'branch="$(git -C "$target" branch --show-current 2>/dev/null)"';
  const script = buildRemotePathResolverScript([
    'limit="$2"',
    'if ! printf "%s" "$limit" | grep -Eq "^[0-9]+$"; then limit=25; fi',
    'if [ "$limit" -lt 1 ]; then limit=1; fi',
    'if [ "$limit" -gt 120 ]; then limit=120; fi',
    'if [ ! -d "$target" ]; then echo "__NOT_DIR__:$target"; exit 0; fi',
    'echo "__ROOT__:$target"',
    'if ! git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "__NOT_GIT__"; exit 0; fi',
    branchInit,
    'if [ -z "$branch" ]; then branch="HEAD"; fi',
    'echo "__BRANCH__:$branch"',
    'if ! git -C "$target" rev-parse --verify HEAD >/dev/null 2>&1; then',
    '  echo "__NO_COMMITS__"',
    '  echo "__TOTAL__:0"',
    '  exit 0',
    'fi',
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
  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 26000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
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
  if (lines.some((line) => line.trim() === '__NO_COMMITS__')) {
    return {
      rootPath,
      isGitRepo: true,
      branch: branchLine.slice('__BRANCH__:'.length).trim() || 'HEAD',
      totalCommits: 0,
      commits: [],
    };
  }
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
  await ensureProjectGitRepository(project, server).catch((error) => {
    console.warn('[ResearchOps] ensure git before git-log failed:', error.message);
  });
  const branchOpts = { branch: project.gitBranch || '' };
  if (project.locationType === 'ssh') {
    return loadSshProjectGitProgress(server, project.projectPath, limit, branchOpts);
  }
  return loadLocalProjectGitProgress(project.projectPath, limit, branchOpts);
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
  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 26000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
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
  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 30000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
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
  await ensureProjectGitRepository(project, server).catch((error) => {
    console.warn('[ResearchOps] ensure git before changed-files failed:', error.message);
  });
  if (project.locationType === 'ssh') {
    return loadSshProjectChangedFiles(server, project.projectPath, limit);
  }
  return loadLocalProjectChangedFiles(project.projectPath, limit);
}

async function checkLocalPath(projectPath) {
  return projectInsightsService.checkLocalProjectPath(projectPath);
}

async function checkSshPath(server, projectPath) {
  const target = String(projectPath || '').trim();
  if (!target) throw new Error('projectPath is required');

  const args = buildSshArgs(server, { connectTimeout: 12 });
  const script = buildRemotePathResolverScript(
    'if [ -d "$target" ]; then echo "__DIR_EXISTS__:$target"; elif [ -e "$target" ]; then echo "__FILE_EXISTS__:$target"; else echo "__NOT_EXISTS__:$target"; fi',
  );
  args.push(
    `${server.user}@${server.host}`,
    'bash', '-s', '--', target,
  );

  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 20000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
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

async function ensureLocalGitRepository(projectPath) {
  if (config.projectInsights?.proxyHeavyOps === true) {
    const result = await projectInsightsProxy.ensureGitRepo({ projectPath });
    const rootPath = String(result?.rootPath || '').trim() || path.resolve(expandHome(projectPath));
    return {
      rootPath,
      isGitRepo: result?.isGitRepo !== false,
      initialized: result?.initialized === true,
    };
  }
  return projectInsightsService.ensureLocalGitRepository(projectPath);
}

async function ensureSshPath(server, projectPath) {
  const target = String(projectPath || '').trim();
  if (!target) throw new Error('projectPath is required');

  const args = buildSshArgs(server, { connectTimeout: 15 });
  const script = buildRemotePathResolverScript(
    'mkdir -p -- "$target"; if [ -d "$target" ]; then echo "__DIR_READY__:$target"; else echo "__NOT_DIR__:$target"; fi',
  );
  args.push(
    `${server.user}@${server.host}`,
    'bash', '-s', '--', target,
  );

  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 25000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
  const output = String(stdout || '').trim();
  const pathMatch = output.match(/:(.*)$/);
  const normalizedPath = pathMatch ? pathMatch[1] : target;
  if (!output.includes('__DIR_READY__')) {
    throw new Error(`Failed to create project path on remote server: ${target}`);
  }
  return { normalizedPath };
}

async function ensureSshGitRepository(server, projectPath) {
  const target = String(projectPath || '').trim();
  if (!target) throw new Error('projectPath is required');

  const args = buildSshArgs(server, { connectTimeout: 15 });

  const script = buildRemotePathResolverScript([
    'if [ ! -d "$target" ]; then echo "__NOT_DIR__:$target"; exit 0; fi',
    'if ! command -v git >/dev/null 2>&1; then echo "__NO_GIT__"; exit 0; fi',
    'if git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  echo "__GIT_READY__:$target"',
    '  echo "__GIT_INITIALIZED__:0"',
    '  exit 0',
    'fi',
    'if git -C "$target" init >/dev/null 2>&1; then',
    '  echo "__GIT_READY__:$target"',
    '  echo "__GIT_INITIALIZED__:1"',
    'else',
    '  echo "__GIT_FAIL__:$target"',
    'fi',
  ].join('\n'));
  args.push(
    `${server.user}@${server.host}`,
    'bash', '-s', '--', target,
  );

  let stdout = '';
  try {
    ({ stdout } = await runCommand('ssh', args, { timeoutMs: 30000, input: `${script}\n` }));
  } catch (error) {
    throw mapSshLikeError(error);
  }
  const lines = String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const notDirLine = lines.find((line) => line.startsWith('__NOT_DIR__:'));
  if (notDirLine) {
    throw new Error(`Remote project path is not a directory: ${notDirLine.slice('__NOT_DIR__:'.length) || target}`);
  }
  if (lines.includes('__NO_GIT__')) {
    throw new Error(`git is not installed on remote host ${server.host}`);
  }
  const failLine = lines.find((line) => line.startsWith('__GIT_FAIL__:'));
  if (failLine) {
    throw new Error(`Failed to initialize git repository at ${failLine.slice('__GIT_FAIL__:'.length) || target}`);
  }
  const readyLine = lines.find((line) => line.startsWith('__GIT_READY__:'));
  const rootPath = readyLine ? readyLine.slice('__GIT_READY__:'.length) : target;
  const initialized = lines.includes('__GIT_INITIALIZED__:1');
  return {
    rootPath,
    isGitRepo: Boolean(readyLine),
    initialized,
  };
}

async function ensureProjectGitRepository(project, server) {
  const projectPath = String(project?.projectPath || '').trim();
  if (!projectPath) {
    throw new Error('Project path is missing');
  }
  if (String(project?.locationType || '').toLowerCase() === 'ssh') {
    return ensureSshGitRepository(server, projectPath);
  }
  return ensureLocalGitRepository(projectPath);
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
  const escapedPath = normalizedPath.replace(/([ \t\n\r\f\v\\'"`$])/g, '\\$1');
  return `${server.user}@${server.host}:${escapedPath}/`;
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
  try {
    return await runCommand('ssh', sshArgs, {
      timeoutMs,
      input: `${String(scriptBody || '').trim()}\n`,
    });
  } catch (error) {
    throw mapSshLikeError(error);
  }
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


function evaluatePaperResourceSignals({
  paperLikeFileCount = 0,
  directoryCount = 0,
  readmeCount = 0,
  totalFileCount = 0,
} = {}) {
  const paperLike = Number(paperLikeFileCount) || 0;
  const dirs = Number(directoryCount) || 0;
  const readme = Number(readmeCount) || 0;
  const totalFiles = Number(totalFileCount) || 0;
  const score = (paperLike * 2) + readme + Math.min(dirs, 5) * 0.25 + Math.min(totalFiles, 12) * 0.2;
  return {
    valid: paperLike >= 2 || totalFiles >= 3 || score >= 5,
    score,
    paperLikeFileCount: paperLike,
    directoryCount: dirs,
    readmeCount: readme,
    totalFileCount: totalFiles,
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

  const [filesResult, dirsResult, readmeResult] = await Promise.all([
    runCommand(
      'find',
      [absolutePath, '-maxdepth', '4', '-type', 'f'],
      { timeoutMs: 30000 }
    ),
    runCommand(
      'find',
      [absolutePath, '-maxdepth', '4', '-type', 'd'],
      { timeoutMs: 30000 }
    ),
    runCommand(
      'find',
      [
        absolutePath,
        '-maxdepth', '4',
        '-type', 'f',
        '(',
        '-iname', 'readme',
        '-o',
        '-iname', 'readme.md',
        ')',
      ],
      { timeoutMs: 30000 }
    ),
  ]);

  const fileLines = String(filesResult?.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 2000);
  const dirLines = String(dirsResult?.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const readmeLines = String(readmeResult?.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let paperLikeFileCount = 0;
  for (const item of fileLines) {
    const rel = item.startsWith(absolutePath) ? item.slice(absolutePath.length).replace(/^\/+/, '') : item;
    if (!rel) continue;
    const lower = rel.toLowerCase();
    const ext = path.extname(lower);
    if (PAPER_RESOURCE_EXTENSIONS.has(ext)) paperLikeFileCount += 1;
  }
  const totalFileCount = fileLines.length;
  const directoryCount = Math.max(dirLines.length - 1, 0);
  const readmeCount = readmeLines.length;

  return {
    exists: true,
    isDirectory: true,
    resourcePath: absolutePath,
    ...evaluatePaperResourceSignals({
      paperLikeFileCount,
      directoryCount,
      readmeCount,
      totalFileCount,
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
    'all_file_count="$(find "$target" -maxdepth 4 -type f 2>/dev/null | wc -l | tr -d \' \')"',
    'echo "__SIGNAL__:${paper_count}:${dir_count}:${readme_count}:${all_file_count}"',
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
  const [
    ,
    paperCountRaw = '0',
    dirCountRaw = '0',
    readmeCountRaw = '0',
    totalCountRaw = paperCountRaw,
  ] = line.replace('__SIGNAL__:', '').split(':');
  return {
    exists: true,
    isDirectory: true,
    resourcePath,
    ...evaluatePaperResourceSignals({
      paperLikeFileCount: normalizeCount(paperCountRaw, 0),
      directoryCount: normalizeCount(dirCountRaw, 0),
      readmeCount: normalizeCount(readmeCountRaw, 0),
      totalFileCount: normalizeCount(totalCountRaw, normalizeCount(paperCountRaw, 0)),
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
  const projectResolved = projectCandidate
    ? path.resolve(expandHome(projectCandidate))
    : '';
  const kbResolved = kbCandidate
    ? path.resolve(expandHome(kbCandidate))
    : '';
  const candidates = [];

  if (projectResolved) {
    const looksLikeKbResourcePath = (
      kbResolved
      && projectResolved === kbResolved
      && path.basename(projectResolved).toLowerCase() === 'resource'
    );
    if (looksLikeKbResourcePath) {
      const projectParent = path.dirname(projectResolved);
      if (projectParent && projectParent !== projectResolved) {
        candidates.push({
          mode: 'project-parent',
          resolvedPath: projectParent,
        });
      }
    }
    candidates.push({
      mode: 'project',
      resolvedPath: projectResolved,
    });
  }

  if (kbResolved) {
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
    'if [ -n "$primary" ] && [ -n "$kb" ] && [ "$primary" = "$kb" ]; then',
    '  base="$(basename "$primary")"',
    '  if [ "$base" = "resource" ]; then',
    '    parent="$(dirname "$primary")"',
    '    if [ -d "$parent" ]; then',
    '      echo "__ROOT__:project-parent:$parent"',
    '      exit 0',
    '    fi',
    '  fi',
    'fi',
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
  if (!rootLine) {
    const error = new Error('Target path is not a directory');
    error.code = 'REMOTE_NOT_DIRECTORY';
    throw error;
  }

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
    const error = new Error(`Target path is not a directory: ${requestedPath}`);
    error.code = 'REMOTE_NOT_DIRECTORY';
    throw error;
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
    const error = new Error('Target path is not a file');
    error.code = 'REMOTE_PATH_NOT_FOUND';
    throw error;
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


// In-memory cache: projectId/rootPath → { files, expiresAt }
const fileListCache = new Map();
const FILE_LIST_TTL_MS = 60 * 1000; // 60 seconds
const KB_RESOURCE_SEED_FILES = [
  'paper_assets_index.md',
  'paper_assets_index.json',
  'notes.md',
  'research_questions.md',
  'proposal_zh.md',
];
const KB_RESOURCE_STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'for',
  'of',
  'in',
  'on',
  'with',
  'from',
  'about',
  'how',
  'what',
  'which',
  'when',
  'where',
  'why',
  'is',
  'are',
  'be',
  'can',
  'should',
  'could',
  'would',
  'need',
  'please',
  'help',
  'compare',
  'comparison',
  'differences',
  'difference',
  'scope',
  'summarize',
  'summary',
  'cite',
  'citation',
  'citations',
  'path',
  'paths',
  'file',
  'files',
  'resource',
  'resources',
  'between',
  'across',
]);

async function getLocalFileList(rootPath) {
  const cached = fileListCache.get(rootPath);
  if (cached && Date.now() < cached.expiresAt) return cached.files;

  // Use plain find: include both files and directories, skip .git entirely.
  // Intentionally avoids git ls-files so .gitignored paths are still visible.
  let files = [];
  try {
    const result = await runCommand('find', [
      rootPath, '-mindepth', '1',
      '-not', '-path', `${rootPath}/.git/*`,
      '-not', '-name', '.git',
      '(', '-type', 'f', '-o', '-type', 'd', ')',
    ], { timeoutMs: 25000 });
    files = [...new Set(
      String(result.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
        .map((fp) => path.relative(rootPath, fp).replace(/\\/g, '/'))
        .filter(Boolean)
    )];
  } catch (_) { /* ignore */ }

  fileListCache.set(rootPath, { files, expiresAt: Date.now() + FILE_LIST_TTL_MS });
  return files;
}

async function searchLocalProjectFiles(projectPath, query, limit = 20) {
  const rootPath = path.resolve(expandHome(String(projectPath || '').trim()));
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const cap = parseLimit(limit, 20, 100);
  const files = await getLocalFileList(rootPath);
  return files
    .filter((fp) => fp.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, cap);
}

async function getSshFileList(server, projectPath) {
  const cacheKey = `ssh:${server.host}:${server.port || 22}:${projectPath}`;
  const cached = fileListCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.files;

  // Fetch all relative paths (files + dirs) from the remote in one SSH call.
  // Intentionally uses plain find — no git ls-files — so .gitignored paths are visible.
  const script = [
    'root="$1"',
    'if [ ! -d "$root" ]; then echo "__NOT_DIR__"; exit 0; fi',
    'find "$root" -mindepth 1 -not -path "*/.git/*" -not -name ".git" \\( -type f -o -type d \\) 2>/dev/null | while IFS= read -r f; do printf "%s\\n" "${f#${root}/}"; done',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [String(projectPath || '').trim()], 35000);
  if (String(stdout || '').includes('__NOT_DIR__')) {
    const error = new Error(`Target path is not a directory: ${String(projectPath || '').trim()}`);
    error.code = 'REMOTE_NOT_DIRECTORY';
    throw error;
  }
  const files = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  fileListCache.set(cacheKey, { files, expiresAt: Date.now() + FILE_LIST_TTL_MS });
  return files;
}

async function searchSshProjectFiles(server, projectPath, query, limit = 20) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const cap = parseLimit(limit, 20, 100);
  const rootPath = String(projectPath || '').trim();
  // Plain find: files + directories, no git, no .gitignore filtering.
  const script = [
    'root="$1"',
    'query="$2"',
    'cap="$3"',
    'if [ ! -d "$root" ]; then echo "__NOT_DIR__"; exit 0; fi',
    'if [ -z "$query" ]; then exit 0; fi',
    'find "$root" -mindepth 1 -not -path "*/.git/*" -not -name ".git" \\( -type f -o -type d \\) 2>/dev/null | sed "s|^${root}/||" | grep -iF -- "$query" | head -n "$cap"',
  ].join('\n');

  try {
    const { stdout } = await runSshScript(server, script, [rootPath, q, String(cap)], 15000);
    const output = String(stdout || '');
    if (output.includes('__NOT_DIR__')) {
      const error = new Error(`Target path is not a directory: ${rootPath}`);
      error.code = 'REMOTE_NOT_DIRECTORY';
      throw error;
    }
    return [...new Set(
      output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    )]
      .sort((a, b) => a.localeCompare(b))
      .slice(0, cap);
  } catch (error) {
    const mapped = mapSshLikeError(error);
    if (mapped.code === 'SSH_TIMEOUT' || mapped.code === 'SSH_COMMAND_FAILED') {
      return [];
    }
    throw mapped;
  }
}

function tokenizeKbResourceQuery(query = '', maxTokens = 8) {
  const normalized = String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9_\-./\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return [];
  const tokens = normalized
    .split(' ')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => item.length >= 2)
    .filter((item) => !KB_RESOURCE_STOPWORDS.has(item));
  const unique = [];
  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    unique.push(token);
    if (unique.length >= maxTokens) break;
  }
  return unique;
}

function isTextLikeResourcePath(relativePath = '') {
  const ext = path.extname(String(relativePath || '').toLowerCase());
  return ['.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.tsv', '.py', '.sh'].includes(ext);
}

function buildResourcePathScore(relativePath = '', query = '', tokens = []) {
  const rel = String(relativePath || '').trim();
  if (!rel) return { score: 0, matchedTerms: [], reasons: [] };
  const relLower = rel.toLowerCase();
  const fileLower = path.posix.basename(relLower);
  const ext = path.posix.extname(fileLower);
  const depth = relLower.split('/').filter(Boolean).length;
  const queryNorm = String(query || '').trim().toLowerCase();
  const paperIntent = /\b(paper|benchmark|bench|compare|comparison|scope|dataset|datasets|result|results|analysis|review|evidence|citation)\b/.test(queryNorm);
  const codeIntent = /\b(code|script|implementation|api|function|class|module|debug|fix|patch)\b/.test(queryNorm);
  let score = 0;
  const matchedTerms = [];
  const reasons = [];

  if (queryNorm && relLower.includes(queryNorm)) {
    score += 9;
    reasons.push('full-query');
  }

  for (const token of tokens) {
    if (!token) continue;
    if (relLower.includes(token)) {
      score += 2;
      matchedTerms.push(token);
      if (fileLower.includes(token)) score += 1.2;
      if (fileLower.startsWith(token)) score += 0.8;
    }
  }

  const seedName = KB_RESOURCE_SEED_FILES.find((seed) => seed.toLowerCase() === fileLower);
  if (seedName) {
    score += 1.8;
    reasons.push('seed-file');
  }
  if (fileLower === 'readme.md') {
    score += 1.1;
    reasons.push('readme');
  }
  if (fileLower.endsWith('meta.json')) {
    score += 1.8;
    reasons.push('meta');
  }
  if (relLower.includes('/arxiv_source/meta.json')) {
    score += 2.2;
    reasons.push('meta-canonical');
  }
  if (fileLower.endsWith('.pdf')) {
    score += 3.4;
    reasons.push('paper-pdf');
  }
  if (fileLower === 'readme.md') {
    score += 4.6;
    reasons.push('paper-readme');
  }
  if (fileLower.endsWith('.md')) score += 0.9;
  if (fileLower === 'paper.pdf') score += 4.0;
  if (fileLower.endsWith('bench.pdf')) score += 2.0;
  if (depth <= 2) score += 1.4;
  if (depth > 4) score -= (depth - 4) * 0.45;
  if (relLower.includes('/arxiv_source/src/')) score -= 3.4;
  if (fileLower.endsWith('.pdf') && relLower.includes('/arxiv_source/src/')) score -= 3.2;
  if (/(^|\/)(fig|figs|images|img|plots)\//.test(relLower)) score -= 3.4;
  if (fileLower.includes('favicon')) score -= 3.0;
  if (fileLower.includes('source.bundle')) score -= 4.2;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty'].includes(ext)) score -= 2.6;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) score -= 3.4;
  if (paperIntent && ['.md', '.pdf', '.json', '.txt'].includes(ext)) score += 2.2;
  if (paperIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score -= 1.6;
  if (codeIntent && ['.py', '.sh', '.ipynb'].includes(ext)) score += 1.4;

  return {
    score,
    matchedTerms: [...new Set(matchedTerms)].slice(0, 8),
    reasons: [...new Set(reasons)],
  };
}

function isEligibleKbResourcePath(relativePath = '') {
  const rel = String(relativePath || '').trim();
  if (!rel) return false;
  const relLower = rel.toLowerCase();
  const fileLower = path.posix.basename(relLower);
  const ext = path.posix.extname(fileLower);
  if (relLower.includes('/arxiv_source/src/')) return false;
  if (/(^|\/)(fig|figs|images|img|plots|assets)\//.test(relLower)) return false;
  if (fileLower.includes('source.bundle') || fileLower.includes('favicon')) return false;
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.sty', '.ipynb'].includes(ext)) return false;
  if (['.tex', '.bib', '.bst', '.bbl', '.cls', '.aux', '.log', '.toc', '.out'].includes(ext)) return false;
  return true;
}

async function loadKbResourcePreview(project, server, kbRootPath, relativePath) {
  if (!isTextLikeResourcePath(relativePath)) return null;
  try {
    const file = String(project?.locationType || '').toLowerCase() === 'ssh'
      ? await readSshProjectTextFile(server, kbRootPath, relativePath, 6000)
      : await readLocalProjectTextFile(kbRootPath, relativePath, 6000);
    const content = String(file?.content || '').trim();
    if (!content) return null;
    return {
      excerpt: content.slice(0, 900),
      truncated: Boolean(file?.truncated),
    };
  } catch (_) {
    return null;
  }
}

async function locateProjectKbResources({
  project,
  server = null,
  kbRootPath = '',
  query = '',
  limit = 20,
  includePreview = true,
} = {}) {
  const cap = parseLimit(limit, 20, 100);
  const q = String(query || '').trim();
  const tokens = tokenizeKbResourceQuery(q, 8);
  const normalizedRoot = String(kbRootPath || '').trim();
  const files = String(project?.locationType || '').toLowerCase() === 'ssh'
    ? await getSshFileList(server, normalizedRoot)
    : await getLocalFileList(path.resolve(expandHome(normalizedRoot)));

  const ranked = [];
  for (const relativePath of files) {
    if (!isEligibleKbResourcePath(relativePath)) continue;
    const scoreData = buildResourcePathScore(relativePath, q, tokens);
    if (!q) {
      const seedMatch = KB_RESOURCE_SEED_FILES.some(
        (seed) => seed.toLowerCase() === String(path.posix.basename(relativePath || '')).toLowerCase()
      );
      if (!seedMatch) continue;
    } else if (scoreData.score <= 0) {
      continue;
    }
    ranked.push({
      path: relativePath,
      score: Number(scoreData.score.toFixed(3)),
      matchedTerms: scoreData.matchedTerms,
      reasons: scoreData.reasons,
    });
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.path || '').localeCompare(String(b.path || ''));
  });
  const perFolderLimit = 3;
  const folderCount = new Map();
  const diversified = [];
  for (const item of ranked) {
    const topFolder = String(item.path || '').split('/')[0] || item.path;
    const used = folderCount.get(topFolder) || 0;
    if (used >= perFolderLimit) continue;
    folderCount.set(topFolder, used + 1);
    diversified.push(item);
    if (diversified.length >= cap) break;
  }

  let items = diversified;
  if (items.length === 0) {
    const seedItems = KB_RESOURCE_SEED_FILES
      .filter((seed) => files.includes(seed))
      .slice(0, cap)
      .map((seed) => ({
        path: seed,
        score: 1,
        matchedTerms: [],
        reasons: ['seed-file'],
      }));
    items = seedItems;
  }

  const previewByPath = new Map();
  if (includePreview) {
    const previewTargets = items.filter((item) => isTextLikeResourcePath(item.path)).slice(0, 4);
    await Promise.all(previewTargets.map(async (item) => {
      const preview = await loadKbResourcePreview(project, server, normalizedRoot, item.path);
      if (preview) previewByPath.set(item.path, preview);
    }));
  }

  return {
    query: q,
    tokens,
    items: items.map((item) => ({
      ...item,
      preview: previewByPath.get(item.path) || null,
    })),
    seedFiles: KB_RESOURCE_SEED_FILES,
  };
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
  // Only list top-level entries (paper directories / files), not recursive
  const { stdout } = await runCommand('find', [rootPath, '-maxdepth', '1', '-mindepth', '1'], { timeoutMs: 40000 });
  const allEntries = String(stdout || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const page = allEntries.slice(safeOffset, safeOffset + safeLimit);
  const items = await Promise.all(page.map(async (absPath) => {
    const relativePath = toRelativePosixPath(rootPath, absPath);
    const stat = await fs.stat(absPath).catch(() => null);
    return {
      relativePath,
      name: path.posix.basename(relativePath),
      type: stat?.isDirectory() ? 'dir' : 'file',
    };
  }));
  return {
    rootPath,
    items,
    totalFiles: allEntries.length,
    offset: safeOffset,
    limit: safeLimit,
    hasMore: safeOffset + page.length < allEntries.length,
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
    'find "$root" -maxdepth 1 -mindepth 1 2>/dev/null | LC_ALL=C sort | while IFS= read -r p; do',
    '  if [ -d "$p" ]; then echo "__ITEM__:dir:$p"; else echo "__ITEM__:file:$p"; fi',
    'done | awk -v off="$off" -v lim="$lim" \'NR>off && NR<=off+lim {print} END {print "__TOTAL__:" NR}\'',
  ].join('\n');
  const { stdout } = await runSshScript(server, script, [rootPath, String(safeOffset), String(safeLimit)], 45000);
  const output = String(stdout || '');
  if (output.includes('__NOT_DIR__')) {
    const error = new Error('KB folder is not a directory');
    error.code = 'REMOTE_NOT_DIRECTORY';
    throw error;
  }

  const lines = output.split(/\r?\n/).filter(Boolean);
  const items = lines
    .filter((line) => line.startsWith('__ITEM__:'))
    .map((line) => {
      const rest = line.slice('__ITEM__:'.length);
      const colonIdx = rest.indexOf(':');
      const type = rest.slice(0, colonIdx); // 'dir' or 'file'
      const absolutePath = rest.slice(colonIdx + 1).trim();
      const relativePath = toRelativePosixPath(rootPath, absolutePath);
      return relativePath ? { relativePath, name: path.posix.basename(relativePath), type } : null;
    })
    .filter(Boolean);
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

function normalizeTodoCandidate(candidate = {}, index = 0) {
  const titleRaw = String(
    candidate.title
    || candidate.task
    || candidate.step
    || candidate.name
    || ''
  ).trim();
  if (!titleRaw) return null;

  const title = titleRaw.length > 120 ? `${titleRaw.slice(0, 117)}...` : titleRaw;
  const hypothesisRaw = String(
    candidate.details
    || candidate.description
    || candidate.hypothesis
    || candidate.rationale
    || title
  ).trim();

  const priorityRaw = String(candidate.priority || '').trim().toLowerCase();
  const priority = ['high', 'medium', 'low'].includes(priorityRaw) ? priorityRaw : 'medium';
  const defaultHypothesis = `Priority: ${priority}. ${title}`;
  return {
    title,
    hypothesis: hypothesisRaw || defaultHypothesis,
    priority,
    order: index + 1,
  };
}

function extractHyphenatedTokens(text = '', { limit = 8 } = {}) {
  const source = String(text || '');
  if (!source) return [];
  const matches = source.match(/\b[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+\b/g) || [];
  const output = [];
  const seen = new Set();
  for (const token of matches) {
    const cleaned = String(token || '').trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }
  return output;
}

function extractLikelyDatasets(text = '', { limit = 6 } = {}) {
  const source = String(text || '');
  const patterns = [
    /\b(M4|M3|M5|ETTh1|ETTh2|ETTm1|ETTm2|Electricity|Traffic|Exchange|Weather|ILI|ECL|PEMS[0-9]+|Monash|Long Horizon)\b/gi,
    /\b(dataset[s]?:?\s*)([A-Za-z0-9_\-/, ]{3,120})/gi,
  ];
  const output = [];
  const seen = new Set();
  for (const pattern of patterns) {
    let match = pattern.exec(source);
    while (match) {
      const value = String(match[1] || match[2] || '').trim();
      if (value) {
        const fragments = value.split(/,|\/|;|\|/).map((item) => item.trim()).filter(Boolean);
        for (const item of fragments) {
          const normalized = item.replace(/\s+/g, ' ');
          const key = normalized.toLowerCase();
          if (normalized.length < 2 || seen.has(key)) continue;
          seen.add(key);
          output.push(normalized);
          if (output.length >= limit) return output;
        }
      }
      match = pattern.exec(source);
    }
  }
  return output;
}

function fallbackTodoCandidatesFromInstruction(instruction = '', project = null) {
  const text = String(instruction || '').trim();
  const modelTokens = extractHyphenatedTokens(text, { limit: 5 });
  const datasetTokens = extractLikelyDatasets(text, { limit: 4 });
  const projectName = String(project?.name || '').trim();
  const hasBenchmarkIntent = /benchmark|compare|evaluation|evaluate|ablation|forecast|timeseries|time series/i.test(text);
  const tasks = [];

  tasks.push({
    title: 'Prepare project environment and dependencies',
    details: `Create reproducible environment (${projectName || 'project'}) and lock package versions for all planned runs.`,
    priority: 'high',
  });

  if (datasetTokens.length > 0) {
    tasks.push({
      title: `Prepare datasets: ${datasetTokens.slice(0, 3).join(', ')}`,
      details: 'Download/verify splits, normalize schema, and add dataset-loading scripts with checksum logging.',
      priority: 'high',
    });
  } else {
    tasks.push({
      title: 'Select and prepare 3 representative datasets',
      details: 'Choose 3 datasets with different frequency/seasonality and define train/validation/test protocol.',
      priority: 'high',
    });
  }

  if (modelTokens.length > 0) {
    tasks.push({
      title: `Implement model runners for ${modelTokens.slice(0, 3).join(', ')}`,
      details: 'Add unified evaluation interface so each model can run under the same metrics and seeds.',
      priority: 'high',
    });
  } else {
    tasks.push({
      title: 'Implement baseline and foundation model runners',
      details: 'Create scripts to run each model with unified CLI arguments and output schema.',
      priority: 'high',
    });
  }

  tasks.push({
    title: hasBenchmarkIntent ? 'Run benchmark matrix across models and datasets' : 'Execute planned experiment matrix',
    details: 'Run experiments with fixed seeds; capture MAE/MSE/sMAPE and runtime/cost metadata per run.',
    priority: 'high',
  });

  tasks.push({
    title: 'Aggregate results and generate comparison report',
    details: 'Build result tables/figures and summarize strengths, limitations, and actionable follow-up experiments.',
    priority: 'medium',
  });

  return tasks
    .map((item, index) => normalizeTodoCandidate(item, index))
    .filter(Boolean)
    .slice(0, 8);
}

async function generateTodoCandidatesFromInstruction({ instruction = '', project = null } = {}) {
  const goal = String(instruction || '').trim();
  if (!goal) return [];
  const projectName = String(project?.name || '').trim();
  const projectDescription = String(project?.description || '').trim();
  const projectPath = String(project?.projectPath || '').trim();
  const timeoutRaw = Number(process.env.RESEARCHOPS_TODO_GENERATION_TIMEOUT_MS || 45000);
  const generationTimeoutMs = Number.isFinite(timeoutRaw)
    ? Math.max(10000, Math.min(Math.floor(timeoutRaw), 120000))
    : 45000;
  const modelTimeoutMs = Math.max(8000, generationTimeoutMs - 5000);
  const prompt = [
    'You are a research project planner.',
    'Generate an actionable TODO list from the instruction below.',
    'Return ONLY a JSON array with no markdown.',
    'Each item schema:',
    '{"title":"...", "details":"...", "priority":"high|medium|low"}',
    'Rules:',
    '- 6 to 10 tasks',
    '- concrete and domain-specific (no generic placeholders)',
    '- each task should be executable in one run/session',
    '- order tasks by dependency',
    '- avoid tasks that require future conclusions before prerequisite runs exist',
    projectName ? `Project: ${projectName}` : '',
    projectDescription ? `Project description: ${projectDescription}` : '',
    projectPath ? `Project path: ${projectPath}` : '',
  ].filter(Boolean).join('\n');

  let modelText = '';
  try {
    const modelTextRaw = await promiseWithTimeout((async () => {
      if (await codexCliService.isAvailable()) {
        const result = await codexCliService.readMarkdown(goal, prompt, { timeout: modelTimeoutMs });
        return String(result?.text || '').trim();
      }
      if (await geminiCliService.isAvailable()) {
        const result = await geminiCliService.readMarkdown(goal, prompt, { timeout: modelTimeoutMs });
        return String(result?.text || '').trim();
      }
      const result = await promiseWithTimeout(
        llmService.generateWithFallback(goal, prompt),
        modelTimeoutMs,
        'TODO generation fallback LLM'
      );
      return String(result?.text || '').trim();
    })(), generationTimeoutMs, 'TODO generation');
    modelText = String(modelTextRaw || '').trim();
  } catch (error) {
    console.warn('[ResearchOps] instruction todo generation via agent failed:', error.message);
    modelText = '';
  }

  const parsed = parseJsonArrayFromModelOutput(modelText);
  const normalized = parsed
    .map((item, index) => normalizeTodoCandidate(item, index))
    .filter(Boolean)
    .slice(0, 10);
  if (normalized.length > 0) return normalized;

  return fallbackTodoCandidatesFromInstruction(goal, project);
}

function normalizeTodoStatus(status = '') {
  return String(status || '').trim().toUpperCase();
}

function isTodoDone(status = '') {
  const normalized = normalizeTodoStatus(status);
  return normalized === 'DONE' || normalized === 'COMPLETED';
}

function parseIsoMs(value = '') {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

const DEFAULT_TSFM_BENCHMARK_COMMAND = [
  'bash -lc',
  '\'set -euo pipefail;',
  'mkdir -p results;',
  'if [ -x scripts/run_tsfm_benchmark.sh ]; then',
  '  bash scripts/run_tsfm_benchmark.sh --models chronos,timesfm,moirai --datasets ETTh1,Electricity,Traffic --output results/tsfm_benchmark;',
  'elif [ -f scripts/run_tsfm_benchmark.py ]; then',
  '  python scripts/run_tsfm_benchmark.py --models chronos,timesfm,moirai --datasets ETTh1,Electricity,Traffic --output results/tsfm_benchmark;',
  'else',
  '  echo "Missing scripts/run_tsfm_benchmark.sh or scripts/run_tsfm_benchmark.py for real TSFM benchmark." >&2;',
  '  exit 1;',
  'fi\'',
].join(' ');

function classifyTodoForNextRun(todo = {}, context = {}) {
  const text = `${String(todo.title || '')} ${String(todo.hypothesis || '')}`.toLowerCase();
  const mentionsKnowledge = /\b(knowledge|paper|literature|survey|scan knowledge base|collect references)\b/.test(text);
  const mentionsExperiment = /\b(run|benchmark|evaluate|experiment|ablation|train|inference|metrics?)\b/.test(text);
  const mentionsWriting = /\b(write|report|summar|discussion|insight|analysis|conclusion|compare)\b/.test(text);
  const mentionsSetup = /\b(setup|prepare|environment|dependency|script|implement|scaffold|config)\b/.test(text);

  let blockedReason = '';
  if (mentionsKnowledge && !context.hasKnowledgeSource) {
    blockedReason = 'Requires knowledge source setup first (KB folder or linked paper group).';
  } else if (mentionsWriting && !context.hasSucceededExperimentRun) {
    blockedReason = 'Requires at least one successful experiment run before writing/analysis.';
  } else if (mentionsExperiment && !context.hasSucceededAgentRun && !context.hasAnyRun) {
    blockedReason = 'Recommended to finish a setup/implementation run before experiment execution.';
  }

  const runType = mentionsExperiment ? 'EXPERIMENT' : 'AGENT';
  const launcherSkill = mentionsWriting
    ? 'write'
    : (mentionsExperiment ? 'experiment' : 'implement');
  const prompt = [
    `Execute this TODO now: ${String(todo.title || '').trim() || 'Untitled TODO'}.`,
    String(todo.hypothesis || '').trim(),
    blockedReason ? '' : 'Focus only on work that can be completed in this single run.',
  ].filter(Boolean).join('\n');
  const suggestedCommand = runType === 'EXPERIMENT'
    ? DEFAULT_TSFM_BENCHMARK_COMMAND
    : null;

  return {
    ideaId: todo.id,
    title: String(todo.title || '').trim(),
    hypothesis: String(todo.hypothesis || '').trim(),
    runType,
    launcherSkill,
    prompt,
    suggestedCommand,
    blocked: Boolean(blockedReason),
    blockedReason,
    whyNow: blockedReason || 'Runnable now with currently available project context.',
  };
}

function buildTodoNextActions({ todos = [], runs = [], project = null } = {}) {
  const openTodos = todos
    .filter((item) => !isTodoDone(item?.status))
    .sort((a, b) => {
      const aUpdated = parseIsoMs(a?.updatedAt || a?.createdAt || '');
      const bUpdated = parseIsoMs(b?.updatedAt || b?.createdAt || '');
      if (aUpdated !== bUpdated) return bUpdated - aUpdated;
      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });

  const hasSucceededExperimentRun = runs.some(
    (run) => String(run?.status || '').toUpperCase() === 'SUCCEEDED'
      && String(run?.runType || '').toUpperCase() === 'EXPERIMENT'
  );
  const hasSucceededAgentRun = runs.some(
    (run) => String(run?.status || '').toUpperCase() === 'SUCCEEDED'
      && String(run?.runType || '').toUpperCase() === 'AGENT'
  );
  const hasAnyRun = runs.length > 0;
  const hasKnowledgeSource = Boolean(String(project?.kbFolderPath || '').trim())
    || (Array.isArray(project?.knowledgeGroupIds) && project.knowledgeGroupIds.length > 0);

  const context = {
    hasSucceededExperimentRun,
    hasSucceededAgentRun,
    hasAnyRun,
    hasKnowledgeSource,
  };

  const candidates = openTodos.map((todo) => classifyTodoForNextRun(todo, context));
  const actionable = candidates.filter((item) => !item.blocked).slice(0, 5);
  const blocked = candidates.filter((item) => item.blocked).slice(0, 5);

  // Fallback: ensure at least one suggestion exists whenever there are open TODOs.
  if (actionable.length === 0 && openTodos.length > 0) {
    const fallback = classifyTodoForNextRun(openTodos[0], {
      ...context,
      hasSucceededExperimentRun: true,
      hasSucceededAgentRun: true,
      hasAnyRun: true,
      hasKnowledgeSource: true,
    });
    actionable.push({
      ...fallback,
      blocked: false,
      blockedReason: '',
      whyNow: 'Fallback suggestion: convert the top open TODO into a runnable step now.',
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    context: {
      openTodoCount: openTodos.length,
      totalRunCount: runs.length,
      hasSucceededExperimentRun,
      hasSucceededAgentRun,
      hasKnowledgeSource,
    },
    actionable,
    blocked,
  };
}

function sanitizeProposalFilename(input = '', fallbackExt = '.md') {
  const extRaw = path.extname(String(input || '').trim()).toLowerCase();
  const ext = extRaw || fallbackExt;
  const safeExt = ['.pdf', '.md', '.markdown', '.txt'].includes(ext) ? ext : fallbackExt;
  return `proposal-latest${safeExt}`;
}

async function proposalFileToText(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return '';
  const mime = String(file.mimetype || '').toLowerCase();
  const filename = String(file.originalname || '').toLowerCase();

  const isPdf = mime.includes('pdf') || filename.endsWith('.pdf');
  if (isPdf) {
    const parsed = await pdfParse(file.buffer);
    return String(parsed?.text || '');
  }

  return file.buffer.toString('utf8');
}

async function saveProposalToProjectDocs({ project, server, file }) {
  const root = String(project?.projectPath || '').trim().replace(/\/+$/, '');
  if (!root) throw new Error('Project path is required to save proposal');

  const fallbackExt = String(file?.mimetype || '').toLowerCase().includes('pdf') ? '.pdf' : '.md';
  const filename = sanitizeProposalFilename(file?.originalname || '', fallbackExt);
  const relativePath = `docs/${filename}`;

  if (project.locationType === 'ssh') {
    const remoteDocsPath = `${root}/docs`;
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'proposal-upload-'));
    try {
      const localDocsDir = path.join(tmpRoot, 'docs');
      await fs.mkdir(localDocsDir, { recursive: true });
      await fs.writeFile(path.join(localDocsDir, filename), file.buffer);
      await ensureSshPath(server, remoteDocsPath);
      await runCommand(
        'rsync',
        ['-az', '-e', buildRsyncSshCommand(server), `${localDocsDir}/`, buildRsyncRemoteDest(server, remoteDocsPath)],
        { timeoutMs: 180000 }
      );
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
    return {
      filename,
      relativePath,
      savedPath: `${remoteDocsPath}/${filename}`,
      docsPath: remoteDocsPath,
    };
  }

  const { absolutePath: docsDir } = resolveLocalProjectPath(root, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  const target = path.join(docsDir, filename);
  await fs.writeFile(target, file.buffer);
  return {
    filename,
    relativePath,
    savedPath: target,
    docsPath: docsDir,
  };
}

function normalizeMarkdownCell(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTodoCandidatesFromIdeaTable(text = '') {
  const source = String(text || '');
  if (!source) return [];

  const markerIdx = source.search(/Create the following Ideas/i);
  if (markerIdx < 0) return [];

  let section = source.slice(markerIdx);
  const stopMarkers = [
    /\n\*\*Expected output\*\*/i,
    /\n###\s+/,
    /\n##\s+/,
  ];
  let sectionEnd = section.length;
  for (const marker of stopMarkers) {
    const idx = section.search(marker);
    if (idx > 0 && idx < sectionEnd) sectionEnd = idx;
  }
  section = section.slice(0, sectionEnd);

  const lines = section.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (!line.includes('|')) continue;
    if (/^\|\s*:?-{2,}/.test(line)) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => normalizeMarkdownCell(cell));
    if (cells.length < 3) continue;

    const firstCell = String(cells[0] || '').toLowerCase();
    if (!firstCell || firstCell === '#' || firstCell === 'title') continue;
    if (!/^\d+[.)]?$/.test(String(cells[0] || '').trim())) continue;

    const title = String(cells[1] || '').trim();
    const details = String(cells.slice(2).join(' | ') || '').trim();
    if (!title || !details) continue;

    const rank = items.length;
    const priority = rank < 3 ? 'high' : (rank < 6 ? 'medium' : 'low');
    const normalized = normalizeTodoCandidate({ title, details, priority }, rank);
    if (!normalized) continue;
    items.push(normalized);
    if (items.length >= 12) break;
  }

  return items;
}

async function parseProposalTodosWithAgent({ text = '', project = null }) {
  const proposalText = String(text || '').trim();
  if (!proposalText) return [];
  const content = proposalText.slice(0, 180000);
  const tableExtracted = extractTodoCandidatesFromIdeaTable(content);
  if (tableExtracted.length >= 4) {
    return tableExtracted.slice(0, 10);
  }
  const projectName = String(project?.name || '').trim();
  const prompt = [
    'You are a software research planning assistant.',
    'Read the proposal and extract an actionable TODO list.',
    'Return ONLY a JSON array, no markdown and no explanation.',
    'Each item must be:',
    '{"title":"...", "details":"...", "priority":"high|medium|low"}',
    'Rules:',
    '- 5 to 10 tasks max',
    '- keep title short and concrete (<= 90 chars)',
    '- details should mention expected outcome',
    '- order tasks by execution sequence',
    projectName ? `Project: ${projectName}` : '',
  ].filter(Boolean).join('\n');

  let modelText = '';
  try {
    if (await codexCliService.isAvailable()) {
      const result = await codexCliService.readMarkdown(content, prompt, { timeout: 180000 });
      modelText = String(result?.text || '').trim();
    } else if (await geminiCliService.isAvailable()) {
      const result = await geminiCliService.readMarkdown(content, prompt, { timeout: 180000 });
      modelText = String(result?.text || '').trim();
    } else {
      const result = await llmService.generateWithFallback(content, prompt);
      modelText = String(result?.text || '').trim();
    }
  } catch (error) {
    console.warn('[ResearchOps] proposal todo parse via agent failed:', error.message);
    modelText = '';
  }

  const parsed = parseJsonArrayFromModelOutput(modelText);
  const normalized = parsed
    .map((item, index) => normalizeTodoCandidate(item, index))
    .filter(Boolean)
    .slice(0, 10);

  if (normalized.length > 0) return normalized;

  const fallbackPlan = planAgentService.generatePlan({
    instruction: content.slice(0, 2000),
    instructionType: 'composite',
  });
  return (Array.isArray(fallbackPlan?.nodes) ? fallbackPlan.nodes : [])
    .map((node, index) => normalizeTodoCandidate({
      title: node?.label || `Planned step ${index + 1}`,
      details: node?.description || node?.label || '',
      priority: index < 2 ? 'high' : 'medium',
    }, index))
    .filter(Boolean)
    .slice(0, 6);
}

async function parseProposalTodosWithDesign({ text = '', project = null }) {
  const proposalText = String(text || '').trim();
  if (!proposalText) return [];
  const content = proposalText.slice(0, 180000);
  const projectName = String(project?.name || '').trim();
  const prompt = [
    'You are a software research planning assistant.',
    'Read the proposal and decompose it into a categorized task list.',
    'Return ONLY a JSON array, no markdown and no explanation.',
    'Each item must be:',
    '{"title":"...", "details":"...", "category":"short-term|long-term|design", "priority":"high|medium|low"}',
    'Categories:',
    '- short-term: concrete implementation tasks completable within days/weeks',
    '- long-term: larger goals or milestones spanning weeks/months',
    '- design: architecture, research, or design decisions that must be made',
    'Rules:',
    '- 6 to 12 tasks total across all categories',
    '- keep title short and concrete (<= 90 chars)',
    '- details should mention expected outcome',
    '- include at least one task from each category',
    projectName ? `Project: ${projectName}` : '',
  ].filter(Boolean).join('\n');

  let modelText = '';
  try {
    if (await codexCliService.isAvailable()) {
      const result = await codexCliService.readMarkdown(content, prompt, { timeout: 180000 });
      modelText = String(result?.text || '').trim();
    } else if (await geminiCliService.isAvailable()) {
      const result = await geminiCliService.readMarkdown(content, prompt, { timeout: 180000 });
      modelText = String(result?.text || '').trim();
    } else {
      const result = await llmService.generateWithFallback(content, prompt);
      modelText = String(result?.text || '').trim();
    }
  } catch (error) {
    console.warn('[ResearchOps] design proposal parse via agent failed:', error.message);
    modelText = '';
  }

  const parsed = parseJsonArrayFromModelOutput(modelText);
  return parsed
    .map((item, index) => {
      const base = normalizeTodoCandidate(item, index);
      if (!base) return null;
      const categoryRaw = String(item.category || '').trim().toLowerCase();
      const category = ['short-term', 'long-term', 'design'].includes(categoryRaw) ? categoryRaw : 'short-term';
      return { ...base, category };
    })
    .filter(Boolean)
    .slice(0, 12);
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

async function deleteObjectStorageKeys(objectKeys = []) {
  const keys = Array.from(new Set(
    (Array.isArray(objectKeys) ? objectKeys : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  const summary = {
    enabled: true,
    attempted: keys.length,
    deleted: 0,
    failed: 0,
    errors: [],
  };
  if (!keys.length) return summary;

  for (const key of keys) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await s3Service.deleteObject(key);
      summary.deleted += 1;
    } catch (error) {
      summary.failed += 1;
      if (summary.errors.length < 25) {
        summary.errors.push({
          key,
          error: sanitizeError(error, 'Failed to delete object from storage'),
        });
      }
    }
  }
  return summary;
}

async function cancelProjectActiveRuns(userId, projectId) {
  const relatedRuns = await researchOpsStore.listRuns(userId, { projectId, limit: 1000 });
  const activeRuns = relatedRuns.filter((run) => ACTIVE_PROJECT_RUN_STATUSES.includes(String(run?.status || '').toUpperCase()));
  await Promise.all(activeRuns.map((run) => researchOpsRunner.cancelRun(userId, run.id).catch(() => null)));
  return activeRuns.map((run) => String(run.id || '').trim()).filter(Boolean);
}

async function deleteProjectWithStorageCleanup(userId, project, { force = false, deleteStorage = true } = {}) {
  const projectId = String(project?.id || '').trim();
  if (!projectId) throw new Error('projectId is required');

  const cancelledActiveRunIds = force
    ? await cancelProjectActiveRuns(userId, projectId)
    : [];

  let objectKeys = [];
  let objectKeyLookupError = '';
  // Collect run IDs before DB deletion so we can clean up S3 prefixes
  let runIdsForS3Cleanup = [];
  if (deleteStorage) {
    try {
      objectKeys = await researchOpsStore.listProjectArtifactObjectKeys(userId, projectId, { limit: 100000 });
    } catch (error) {
      objectKeyLookupError = sanitizeError(error, 'Failed to collect storage keys for project deletion');
    }
    try {
      const allRuns = await researchOpsStore.listRuns(userId, { projectId, limit: 10000 });
      runIdsForS3Cleanup = allRuns.map((r) => String(r.id || '').trim()).filter(Boolean);
    } catch (_) { /* non-fatal */ }
  }

  const summary = await researchOpsStore.deleteProject(userId, projectId, { force });
  if (!summary) return null;

  const storage = {
    enabled: Boolean(deleteStorage),
    attempted: 0,
    deleted: 0,
    failed: 0,
    lookupError: objectKeyLookupError || null,
    errors: [],
  };
  if (deleteStorage && !objectKeyLookupError) {
    const deletedStorage = await deleteObjectStorageKeys(objectKeys);
    storage.attempted = deletedStorage.attempted;
    storage.deleted = deletedStorage.deleted;
    storage.failed = deletedStorage.failed;
    storage.errors = deletedStorage.errors;
  }
  // Also delete orphaned S3 objects under runs/<runId>/ prefix (not tracked in DB artifacts table)
  if (deleteStorage && runIdsForS3Cleanup.length > 0) {
    for (const runId of runIdsForS3Cleanup) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const { deleted, failed } = await s3Service.deleteObjectsByPrefix(`runs/${runId}/`);
        storage.deleted += deleted;
        storage.failed += failed;
      } catch (_) { /* non-fatal */ }
    }
  }

  return {
    ...summary,
    storage,
    cancelledActiveRunIds,
  };
}

// ── Agent session cache helpers ───────────────────────────────────────────────

const AGENT_SESSION_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

async function writeAgentSessionCache(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  for (const s of sessions) {
    const id = String(s.id || '').trim();
    // Use gitRoot as the canonical key — same value the live filter uses
    const projectPath = String(s.gitRoot || s.cwd || '').replace(/\/+$/, '').trim();
    if (!id || !projectPath) continue;
    try {
      await db.execute({
        sql: `INSERT OR REPLACE INTO agent_session_cache (session_id, project_path, data, cached_at) VALUES (?, ?, ?, ?)`,
        args: [id, projectPath, JSON.stringify(s), now],
      });
    } catch (_) { /* best-effort */ }
  }
}

async function readAgentSessionCache(projectPath) {
  const db = getDb();
  const cutoff = new Date(Date.now() - AGENT_SESSION_CACHE_MAX_AGE_MS).toISOString();
  // Exact match on gitRoot — no LIKE needed since gitRoot is already the canonical repo root
  const normalized = String(projectPath || '').replace(/\/+$/, '');
  const result = await db.execute({
    sql: `SELECT data FROM agent_session_cache
          WHERE project_path = ?
            AND cached_at > ?
          ORDER BY cached_at DESC LIMIT 60`,
    args: [normalized, cutoff],
  });
  return result.rows
    .map((row) => { try { return JSON.parse(row.data); } catch (_) { return null; } })
    .filter(Boolean);
}

// ── Routes ────────────────────────────────────────────────────────────────────

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
    let gitInit = null;
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
      try {
        gitInit = await ensureLocalGitRepository(ensuredPath);
      } catch (gitError) {
        if (config.projectInsights?.proxyHeavyOps === true) {
          return res.status(502).json({
            error: sanitizeError(gitError, 'Local executor unavailable for git initialization'),
          });
        }
        throw gitError;
      }
    } else {
      if (!serverId) {
        return res.status(400).json({ error: 'serverId is required when locationType=ssh' });
      }
      const server = await getSshServerById(serverId);
      if (!server) {
        return res.status(404).json({ error: `SSH server ${serverId} not found` });
      }
      enforceSshProjectPathPolicy(server, projectPath);
      const result = await ensureSshPath(server, projectPath);
      ensuredPath = result.normalizedPath;
      ensuredServerId = String(server.id);
      gitInit = await ensureSshGitRepository(server, ensuredPath);
    }

    const project = await researchOpsStore.createProject(getUserId(req), {
      name: req.body?.name,
      description: req.body?.description,
      locationType,
      serverId: locationType === 'ssh' ? ensuredServerId : undefined,
      projectPath: ensuredPath,
    });
    res.status(201).json({ project, git: gitInit });
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
    const server = await getSshServerById(serverId);
    if (!server) {
      return res.status(404).json({ error: `SSH server ${serverId} not found` });
    }
    enforceSshProjectPathPolicy(server, projectPath);
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

router.patch('/projects/:projectId', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const allowed = {};
    if (req.body?.name !== undefined) allowed.name = req.body.name;
    if (req.body?.description !== undefined) allowed.description = req.body.description;
    if (req.body?.projectPath !== undefined) {
      const rawPath = String(req.body.projectPath || '').trim();
      if (!rawPath) return res.status(400).json({ error: 'projectPath cannot be empty' });
      const existingProject = await researchOpsStore.getProject(getUserId(req), projectId);
      if (!existingProject) return res.status(404).json({ error: 'Project not found' });
      if (String(existingProject.locationType || '').toLowerCase() === 'ssh') {
        const server = await getSshServerById(existingProject.serverId);
        if (!server) return res.status(404).json({ error: `SSH server ${existingProject.serverId} not found` });
        enforceSshProjectPathPolicy(server, rawPath);
        const ensured = await ensureSshPath(server, rawPath);
        await ensureSshGitRepository(server, ensured.normalizedPath);
        allowed.projectPath = ensured.normalizedPath;
      } else {
        let ensuredPath = rawPath;
        if (config.projectInsights?.proxyHeavyOps === true) {
          const ensured = await projectInsightsProxy.ensurePath({ projectPath: rawPath });
          ensuredPath = String(ensured?.normalizedPath || '').trim() || path.resolve(expandHome(rawPath));
        } else {
          const ensured = await ensureLocalPath(rawPath);
          ensuredPath = ensured.normalizedPath;
        }
        await ensureLocalGitRepository(ensuredPath);
        allowed.projectPath = ensuredPath;
      }
    }
    if (req.body?.gitBranch !== undefined) {
      allowed.gitBranch = String(req.body.gitBranch || '').trim() || null;
    }

    const project = await researchOpsStore.updateProject(getUserId(req), projectId, allowed);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json({ project });
  } catch (error) {
    console.error('[ResearchOps] updateProject failed:', error);
    res.status(400).json({ error: sanitizeError(error, 'Failed to update project') });
  }
});

router.delete('/projects/:projectId', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const userId = getUserId(req);

    const force = parseBoolean(req.query?.force, parseBoolean(req.body?.force, false));
    const deleteStorage = parseBoolean(req.query?.deleteStorage, parseBoolean(req.body?.deleteStorage, true));
    const project = await researchOpsStore.getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const summary = await deleteProjectWithStorageCleanup(userId, project, { force, deleteStorage });
    if (!summary) return res.status(404).json({ error: 'Project not found' });
    return res.json({
      success: true,
      projectId,
      force,
      deleteStorage,
      summary,
    });
  } catch (error) {
    if (error.code === 'PROJECT_HAS_ACTIVE_RUNS') {
      return res.status(409).json({
        error: 'Project has active runs. Stop/cancel them first or retry with force=true.',
        activeRuns: Array.isArray(error.activeRuns) ? error.activeRuns : [],
      });
    }
    console.error('[ResearchOps] deleteProject failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to delete project') });
  }
});

/**
 * Batch workspace snapshot — replaces 4 separate requests with 1.
 * Returns git-log, changed-files, file-tree (project root), and KB entries
 * all in a single round-trip. Each section is independent; failures are
 * captured per-section so a broken git repo doesn't hide the file tree.
 *
 * GET /projects/:projectId/workspace?gitLimit=10&treeLimit=240&kbLimit=300
 */
router.get('/projects/:projectId/workspace', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const gitLimit = parseLimit(req.query.gitLimit, 10, 120);
    const treeLimit = parseLimit(req.query.treeLimit, 240, 500);

    await ensureProjectGitRepository(project, server).catch((error) => {
      console.warn('[ResearchOps] workspace git initialization skipped:', error.message);
    });

    // Helper: run an async fn and return { ok, value, error } instead of throwing
    const settle = (fn) => fn().then((v) => ({ ok: true, value: v })).catch((e) => ({ ok: false, error: e.message }));

    // ── git-log ──────────────────────────────────────────────────────────────
    const gitTask = settle(async () => {
      if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
        try {
          return await projectInsightsProxy.getGitLog({
            projectPath: project.projectPath,
            branch: project.gitBranch || '',
            limit: gitLimit,
          });
        } catch (_) { /* fall through to direct */ }
      }
      return loadProjectGitProgress(project, server, gitLimit);
    });

    // ── changed-files ────────────────────────────────────────────────────────
    const changedTask = settle(async () => {
      if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
        try {
          return await projectInsightsProxy.getChangedFiles({ projectPath: project.projectPath, limit: 200 });
        } catch (_) { /* fall through */ }
      }
      return loadProjectChangedFiles(project, server, 200);
    });

    // ── file-tree (project root, depth 1) ───────────────────────────────────
    const treeTask = settle(async () => {
      const browseRoot = await resolveProjectBrowseRoot(project, server);
      if (!browseRoot.rootPath) throw new Error('No accessible root path');
      const tree = project.locationType === 'ssh'
        ? await listSshProjectDirectory(server, browseRoot.rootPath, '', treeLimit)
        : await listLocalProjectDirectory(browseRoot.rootPath, '', treeLimit);
      return { rootMode: browseRoot.rootMode, ...tree };
    });

    // ── KB top-level entries (all at once, no pagination) ───────────────────
    const kbTask = settle(async () => {
      const kbRoot = String(project.kbFolderPath || '').trim()
        || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
      const result = project.locationType === 'ssh'
        ? await listSshKnowledgeBaseFiles(server, kbRoot, { offset: 0, limit: 500 })
        : await listLocalKnowledgeBaseFiles(kbRoot, { offset: 0, limit: 500 });
      return result;
    });

    // ── python venv status (.pixi / .uv) ─────────────────────────────────────
    const venvTask = settle(async () => detectProjectVenvStatus(project, server));

    // Run all sections in parallel — one network round-trip
    const [git, changed, tree, kb, venv] = await Promise.all([gitTask, changedTask, treeTask, kbTask, venvTask]);

    return res.json({
      projectId: project.id,
      projectPath: project.projectPath,
      gitBranch: project.gitBranch || null,
      locationType: project.locationType,
      refreshedAt: new Date().toISOString(),
      venvStatus: venv.ok ? venv.value : null,
      venvError: venv.ok ? null : venv.error,
      gitProgress: git.ok ? git.value : null,
      gitError: git.ok ? null : git.error,
      changedFiles: changed.ok ? changed.value : null,
      changedFilesError: changed.ok ? null : changed.error,
      fileTree: tree.ok ? tree.value : null,
      fileTreeError: tree.ok ? null : tree.error,
      kbEntries: kb.ok ? kb.value : null,
      kbError: kb.ok ? null : kb.error,
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'PROJECT_PATH_MISSING') return res.status(400).json({ error: 'Project path is not configured' });
    console.error('[ResearchOps] workspace batch failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to load project workspace') });
  }
});

router.get('/projects/:projectId/venv/status', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const status = await detectProjectVenvStatus(project, server);
    return res.json({
      projectId: project.id,
      locationType: project.locationType,
      status,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'PROJECT_PATH_MISSING') return res.status(400).json({ error: 'Project path is not configured' });
    console.error('[ResearchOps] project venv status failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to detect project virtual environment') });
  }
});

router.post('/projects/:projectId/venv/setup', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const toolRaw = String(req.body?.tool || '').trim().toLowerCase();
    const tool = toolRaw === 'uv' ? 'uv' : 'pixi';
    const result = await setupProjectVenv(project, server, tool);
    const status = await detectProjectVenvStatus(project, server);
    return res.json({
      success: true,
      projectId: project.id,
      locationType: project.locationType,
      configuredTool: result.tool,
      status,
      message: `Virtual environment configured with ${result.tool}.`,
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'PROJECT_PATH_MISSING') return res.status(400).json({ error: 'Project path is not configured' });
    console.error('[ResearchOps] project venv setup failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to set up project virtual environment') });
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

    await ensureProjectGitRepository(project, server).catch((error) => {
      console.warn('[ResearchOps] git-log git initialization skipped:', error.message);
    });

    if (config.projectInsights?.proxyHeavyOps === true && project.locationType === 'local') {
      try {
        gitProgress = await projectInsightsProxy.getGitLog({
          projectPath: project.projectPath,
          branch: project.gitBranch || '',
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
    if (error.code === 'SSH_AUTH_FAILED') {
      return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    }
    if (error.code === 'SSH_HOST_UNREACHABLE') {
      return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    }
    console.error('[ResearchOps] project git-log failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to load project git log'));
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
    if (error.code === 'SSH_AUTH_FAILED') {
      return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    }
    if (error.code === 'SSH_HOST_UNREACHABLE') {
      return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    }
    console.error('[ResearchOps] project server-files failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to load project files'));
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

    await ensureProjectGitRepository(project, server).catch((error) => {
      console.warn('[ResearchOps] changed-files git initialization skipped:', error.message);
    });

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
    if (error.code === 'SSH_AUTH_FAILED') {
      return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    }
    if (error.code === 'SSH_HOST_UNREACHABLE') {
      return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    }
    console.error('[ResearchOps] project changed-files failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to load project changed files'));
  }
});

// ── Interactive Agent Bash session routes ─────────────────────────────────────

router.get('/projects/:projectId/agent-sessions', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const userId = getUserId(req);
    const limit = parseLimit(req.query.limit, 80, 500);
    const sessions = await interactiveAgentService.listProjectSessions(userId, projectId, { limit });
    return res.json({ sessions });
  } catch (error) {
    console.error('[ResearchOps] listProjectSessions failed:', error);
    return res.status(500).json({ error: 'Failed to list sessions' });
  }
});

router.post('/projects/:projectId/agent-sessions', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const userId = getUserId(req);
    const session = await interactiveAgentService.createSession(userId, projectId, req.body || {});
    return res.json({ session });
  } catch (error) {
    console.error('[ResearchOps] createSession failed:', error);
    return res.status(500).json({ error: error.message || 'Failed to create session' });
  }
});

router.get('/agent-sessions/:sid', async (req, res) => {
  try {
    const sessionId = String(req.params.sid || '').trim();
    const userId = getUserId(req);
    const result = await interactiveAgentService.getSession(userId, sessionId);
    if (!result) return res.status(404).json({ error: 'Session not found' });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] getSession failed:', error);
    return res.status(500).json({ error: 'Failed to get session' });
  }
});

router.get('/agent-sessions/:sid/messages', async (req, res) => {
  try {
    const sessionId = String(req.params.sid || '').trim();
    const userId = getUserId(req);
    const afterSequence = Number(req.query.afterSequence ?? -1);
    const limit = parseLimit(req.query.limit, 300, 1000);
    const result = await interactiveAgentService.listSessionMessages(userId, sessionId, {
      afterSequence,
      limit,
    });
    return res.json(result);
  } catch (error) {
    console.error('[ResearchOps] listSessionMessages failed:', error);
    return res.status(500).json({ error: 'Failed to list messages' });
  }
});

router.post(
  '/agent-sessions/:sid/messages',
  agentSessionImageUpload.array('images', 10),
  async (req, res) => {
    try {
      const sessionId = String(req.params.sid || '').trim();
      const userId = getUserId(req);

      const content = String(req.body?.content || '').trim();
      let imageMeta = [];
      try { imageMeta = JSON.parse(req.body?.imageMeta || '[]'); } catch (_) {}

      const attachments = [];
      const files = Array.isArray(req.files) ? req.files : [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const meta = imageMeta[i] || {};
        const filename = String(file.originalname || `image_${i}.png`).trim();
        const mimeType = String(file.mimetype || 'image/png').trim();
        try {
          const objectKey = `agent-sessions/${sessionId}/attachments/${Date.now()}-${i}-${filename}`;
          await s3Service.uploadBuffer(file.buffer, objectKey, mimeType);
          const objectUrl = await s3Service.generatePresignedDownloadUrl(objectKey).catch(() => null);
          attachments.push({
            kind: 'image',
            filename,
            mimeType,
            sizeBytes: file.size || 0,
            objectKey,
            objectUrl: objectUrl || objectKey,
            note: String(meta.note || '').trim(),
          });
        } catch (uploadErr) {
          console.warn('[ResearchOps] agent-session image upload failed, skipping:', uploadErr.message);
        }
      }

      const result = await interactiveAgentService.sendUserMessage(userId, sessionId, {
        content,
        attachments,
        provider: String(req.body?.provider || '').trim(),
        model: String(req.body?.model || '').trim(),
        reasoningEffort: String(req.body?.reasoningEffort || '').trim(),
        serverId: String(req.body?.serverId || '').trim(),
      });
      return res.json(result);
    } catch (error) {
      console.error('[ResearchOps] sendUserMessage failed:', error);
      if (error.code === 'SESSION_NOT_FOUND') return res.status(404).json({ error: 'Session not found' });
      if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
      return res.status(500).json({ error: error.message || 'Failed to send message' });
    }
  }
);

router.post('/agent-sessions/:sid/stop', async (req, res) => {
  try {
    const sessionId = String(req.params.sid || '').trim();
    const userId = getUserId(req);

    const sessionResult = await interactiveAgentService.getSession(userId, sessionId);
    if (!sessionResult) return res.status(404).json({ error: 'Session not found' });

    const { session } = sessionResult;
    const activeRunId = String(session?.activeRunId || '').trim();
    if (activeRunId) {
      await researchOpsStore.updateRunStatus(userId, activeRunId, 'CANCELLED', 'User stopped interactive session').catch(() => {});
    }

    await researchOpsStore.updateAgentSession(userId, sessionId, {
      status: 'IDLE',
      activeRunId: null,
      lastRunStatus: activeRunId ? 'CANCELLED' : session.lastRunStatus,
      lastMessage: 'Session stopped by user.',
    });

    const updated = await interactiveAgentService.getSession(userId, sessionId);
    return res.json(updated || { session: null, activeRun: null });
  } catch (error) {
    console.error('[ResearchOps] stopSession failed:', error);
    return res.status(500).json({ error: 'Failed to stop session' });
  }
});

// ── Observed agent sessions route ─────────────────────────────────────────────

/**
 * Observed agent sessions from local Claude Code / Codex filesystem logs.
 * Live from processing server when available; falls back to DB cache when offline.
 * GET /agent-sessions?projectPath=...
 */
router.get('/agent-sessions', async (req, res) => {
  const projectPath = String(req.query.projectPath || '').trim();
  if (config.projectInsights?.proxyHeavyOps === true) {
    try {
      const result = await projectInsightsProxy.getAgentSessions({ projectPath });
      const items = Array.isArray(result?.items) ? result.items : [];
      // Persist to DB cache in background so it survives processing server restarts
      writeAgentSessionCache(items).catch(() => {});
      return res.json({ items, cached: false });
    } catch (proxyError) {
      console.warn('[ResearchOps] agent-sessions proxy offline, serving from cache:', proxyError.message);
    }
  }
  // Fallback: read from DB cache
  try {
    const items = await readAgentSessionCache(projectPath);
    return res.json({ items, cached: true });
  } catch (cacheError) {
    console.warn('[ResearchOps] agent-sessions cache read failed:', cacheError.message);
    return res.json({ items: [], cached: true });
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
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'REMOTE_NOT_DIRECTORY') return res.status(400).json(toErrorPayload(error, 'Remote path is not a directory'));
    console.error('[ResearchOps] kb/files failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to load KB files'));
  }
});

// POST /api/researchops/projects/:projectId/kb/add-paper
// Download paper resources (PDF, LaTeX source, GitHub code) directly into project KB folder
router.post('/projects/:projectId/kb/add-paper', async (req, res) => {
  const documentService = require('../../services/document.service');
  const arxivService = require('../../services/arxiv.service');
  const { fetchArxivSource, fetchGitHubRepoZip } = require('../../services/research-pack.service');

  const projectId = String(req.params.projectId || '').trim();
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });

  const documentId = req.body?.documentId;
  if (!documentId) return res.status(400).json({ error: 'documentId is required' });

  const includePdf = parseBoolean(req.body?.includePdf, true);
  const includeLatex = parseBoolean(req.body?.includeLatex, false);
  const includeCode = parseBoolean(req.body?.includeCode, false);

  try {
    const [doc, { project, server }] = await Promise.all([
      documentService.getDocumentById(documentId),
      resolveProjectContext(getUserId(req), projectId),
    ]);

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const kbFolder = String(project.kbFolderPath || '').trim()
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;

    const sanitizedTitle = doc.title
      .replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 60) || `paper_${doc.id}`;

    const arxivId = doc.originalUrl ? arxivService.parseArxivUrl(doc.originalUrl) : null;
    const results = {};
    const filesToWrite = {};

    // 1. PDF
    if (includePdf) {
      try {
        let pdfBuffer;
        if (doc.s3Key) {
          pdfBuffer = await s3Service.downloadBuffer(doc.s3Key);
        } else if (arxivId) {
          pdfBuffer = await arxivService.fetchPdf(arxivId);
        }
        if (pdfBuffer) {
          filesToWrite['paper.pdf'] = pdfBuffer;
          results.pdf = { ok: true, bytes: pdfBuffer.length };
        } else {
          results.pdf = { ok: false, error: 'No PDF source available' };
        }
      } catch (err) {
        results.pdf = { ok: false, error: err.message };
      }
    }

    // 2. LaTeX source (arXiv only)
    if (includeLatex) {
      if (!arxivId) {
        results.latex = { ok: false, error: 'Not an arXiv paper' };
      } else {
        try {
          const latexBuffer = await fetchArxivSource(arxivId);
          filesToWrite['latex_source.tar.gz'] = latexBuffer;
          results.latex = { ok: true, bytes: latexBuffer.length };
        } catch (err) {
          results.latex = { ok: false, error: err.message };
        }
      }
    }

    // 3. GitHub code
    if (includeCode) {
      if (!doc.codeUrl) {
        results.code = { ok: false, error: 'No code URL on this document' };
      } else {
        try {
          const { buffer, repoName } = await fetchGitHubRepoZip(doc.codeUrl);
          filesToWrite[`code_${repoName}.zip`] = buffer;
          results.code = { ok: true, bytes: buffer.length, repoName };
        } catch (err) {
          results.code = { ok: false, error: err.message };
        }
      }
    }

    let paperFolder;

    if (Object.keys(filesToWrite).length > 0) {
      if (project.locationType === 'ssh') {
        // Write to temp dir, then SCP to remote server
        const tmpDir = path.join(os.tmpdir(), `kb_paper_${Date.now()}_${sanitizedTitle}`);
        await fs.mkdir(tmpDir, { recursive: true });
        try {
          for (const [filename, buffer] of Object.entries(filesToWrite)) {
            await fs.writeFile(path.join(tmpDir, filename), buffer);
          }

          const paperFolderRemote = `${kbFolder}/${sanitizedTitle}`;
          const keyPath = expandHome(server.ssh_key_path || '~/.ssh/id_rsa');
          const sshBaseArgs = buildSshArgs(server, { connectTimeout: 15 });

          // Create remote directory
          await runCommand('ssh', [
            ...sshBaseArgs,
            `${server.user}@${server.host}`,
            `mkdir -p -- ${JSON.stringify(paperFolderRemote)}`,
          ], { timeoutMs: 20000 });

          // SCP each file — build args with ProxyCommand (scp uses -P for port)
          const scpBaseArgs = [
            '-F', '/dev/null',
            '-o', 'BatchMode=yes',
            '-o', 'ClearAllForwardings=yes',
            '-o', 'ConnectTimeout=15',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-i', keyPath,
            '-P', String(server.port || 22),
          ];
          {
            const _pj = String(server.proxy_jump || '').trim();
            if (_pj) {
              const _m = _pj.match(/^((?:[^@]+)@)?([^:@]+)(?::(\d+))?$/);
              if (_m) {
                const _parts = ['ssh', '-F', '/dev/null', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=15', '-i', keyPath];
                if (_m[3]) _parts.push('-p', _m[3]);
                _parts.push('-W', '%h:%p', `${_m[1] || ''}${_m[2]}`);
                scpBaseArgs.push('-o', `ProxyCommand=${_parts.join(' ')}`);
              } else { scpBaseArgs.push('-J', _pj); }
            }
          }
          for (const filename of Object.keys(filesToWrite)) {
            const localFile = path.join(tmpDir, filename);
            const remoteFile = `${paperFolderRemote}/${filename}`;
            await runCommand('scp', [
              ...scpBaseArgs,
              localFile,
              `${server.user}@${server.host}:${remoteFile}`,
            ], { timeoutMs: 120000 });
          }

          paperFolder = paperFolderRemote;
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      } else {
        // Local: write directly
        const expandedKb = expandHome(kbFolder);
        const paperFolderLocal = path.resolve(expandedKb, sanitizedTitle);
        await fs.mkdir(paperFolderLocal, { recursive: true });
        for (const [filename, buffer] of Object.entries(filesToWrite)) {
          await fs.writeFile(path.join(paperFolderLocal, filename), buffer);
        }
        paperFolder = paperFolderLocal;
      }
    } else {
      paperFolder = `${kbFolder}/${sanitizedTitle}`;
    }

    return res.json({ ok: true, results, paperFolder, documentTitle: doc.title });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json({ error: sanitizeError(error, 'SSH server not found') });
    console.error('[ResearchOps] kb/add-paper failed:', error);
    return res.status(500).json({ error: sanitizeError(error, 'Failed to add paper to KB') });
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
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    if (error.code === 'REMOTE_PATH_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'Remote path not found'));
    if (error.code === 'REMOTE_NOT_DIRECTORY') return res.status(400).json(toErrorPayload(error, 'Remote path is not a directory'));
    console.error('[ResearchOps] files/tree failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to load project file tree'));
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
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    if (error.code === 'REMOTE_PATH_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'Remote path not found'));
    if (error.code === 'REMOTE_NOT_DIRECTORY') return res.status(400).json(toErrorPayload(error, 'Remote path is not a directory'));
    console.error('[ResearchOps] files/content failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to read project file content'));
  }
});

router.get('/projects/:projectId/files/search', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const query = String(req.query.q || req.query.query || '').trim();
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
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    if (error.code === 'REMOTE_PATH_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'Remote path not found'));
    if (error.code === 'REMOTE_NOT_DIRECTORY') return res.status(400).json(toErrorPayload(error, 'Remote path is not a directory'));
    console.error('[ResearchOps] files/search failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to search project files'));
  }
});

router.get('/projects/:projectId/kb/resource-locate', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const query = String(req.query.q || req.query.query || '').trim();
    const limit = parseLimit(req.query.limit, 20, 100);
    const includePreview = parseBoolean(req.query.includePreview, true);
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const kbRootPath = String(project.kbFolderPath || '').trim()
      || `${String(project.projectPath || '').replace(/\/+$/, '')}/resource`;
    if (!kbRootPath) {
      return res.status(400).json({ error: 'No KB root path configured for this project' });
    }

    const located = await locateProjectKbResources({
      project,
      server,
      kbRootPath,
      query,
      limit,
      includePreview,
    });

    return res.json({
      projectId: project.id,
      rootMode: 'kb-folder',
      rootPath: kbRootPath,
      ...located,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    if (error.code === 'REMOTE_PATH_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'Remote path not found'));
    if (error.code === 'REMOTE_NOT_DIRECTORY') return res.status(400).json(toErrorPayload(error, 'Remote path is not a directory'));
    console.error('[ResearchOps] kb/resource-locate failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to locate KB resources'));
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

router.get('/projects/:projectId/todos/next-actions', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const userId = getUserId(req);
    const project = await researchOpsStore.getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const [todos, runs] = await Promise.all([
      researchOpsStore.listIdeas(userId, { projectId, limit: 400 }),
      researchOpsStore.listRuns(userId, { projectId, limit: 400 }),
    ]);
    const payload = buildTodoNextActions({ todos, runs, project });
    return res.json(payload);
  } catch (error) {
    console.error('[ResearchOps] next todo actions failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate next TODO actions') });
  }
});

router.post('/projects/:projectId/todos/clear', async (req, res) => {
  try {
    const userId = getUserId(req);
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const project = await researchOpsStore.getProject(userId, projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const targetStatus = cleanString(req.body?.status).toUpperCase() || 'COMPLETED';
    const includeDone = parseBoolean(req.body?.includeDone, false);
    const todos = await researchOpsStore.listIdeas(userId, { projectId, limit: 1000 });
    const doneStatuses = new Set(['DONE', 'COMPLETED', targetStatus]);
    const targets = Array.isArray(todos)
      ? todos.filter((todo) => (includeDone ? true : !doneStatuses.has(cleanString(todo?.status).toUpperCase())))
      : [];

    await Promise.all(targets.map((todo) => researchOpsStore.updateIdea(userId, todo.id, {
      status: targetStatus,
      summary: `Cleared in bulk on ${new Date().toISOString()}`,
    })));

    return res.json({
      projectId,
      cleared: targets.length,
      totalTodos: Array.isArray(todos) ? todos.length : 0,
      status: targetStatus,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[ResearchOps] clear todos failed:', error);
    return res.status(400).json(toErrorPayload(error, 'Failed to clear TODOs'));
  }
});

router.post('/projects/:projectId/todos/from-proposal', proposalUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'proposal file is required' });
    }

    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const userId = getUserId(req);
    const { project, server } = await resolveProjectContext(userId, projectId);
    // Best-effort: save proposal file to project docs (may fail for SSH projects
    // where the API host lacks direct SSH access to the remote server).
    let saved = { relativePath: req.file.originalname, savedPath: null };
    try {
      saved = await saveProposalToProjectDocs({ project, server, file: req.file });
    } catch (saveErr) {
      console.warn('[ResearchOps] Could not save proposal to project docs (continuing):', saveErr.message);
    }
    const extractedText = String(await proposalFileToText(req.file)).trim();
    if (!extractedText) {
      return res.status(400).json({ error: 'No extractable text found in proposal file' });
    }

    const designMode = req.query.design === 'true';
    const todoCandidates = designMode
      ? await parseProposalTodosWithDesign({ text: extractedText, project })
      : await parseProposalTodosWithAgent({ text: extractedText, project });
    if (todoCandidates.length === 0) {
      return res.status(400).json({ error: 'Failed to extract TODOs from the proposal' });
    }

    const createdIdeas = [];
    const createdAtIso = new Date().toISOString();
    for (const candidate of todoCandidates) {
      const categoryTag = candidate.category ? ` [${candidate.category}]` : '';
      // eslint-disable-next-line no-await-in-loop
      const idea = await researchOpsStore.createIdea(userId, {
        projectId: project.id,
        title: candidate.title,
        hypothesis: candidate.hypothesis,
        summary: `LLM-generated TODO from proposal (${createdAtIso}, ${saved.relativePath})${categoryTag}`,
        status: 'OPEN',
      });
      createdIdeas.push({ ...idea, category: candidate.category || null });
    }

    return res.status(201).json({
      proposal: {
        name: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        savedPath: saved.savedPath,
        relativePath: saved.relativePath,
      },
      designMode,
      createdCount: createdIdeas.length,
      ideas: createdIdeas,
    });
  } catch (error) {
    console.error('[ResearchOps] generate todos from proposal failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to generate TODOs from proposal') });
  }
});

// Run tree (parent-child structure)
router.get('/projects/:projectId/run-tree', async (req, res) => {
  try {
    const uid = getUserId(req);
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 100), 400);

    const runs = await researchOpsStore.listRuns(uid, { projectId, limit });

    // Build adjacency map
    const nodeMap = {};
    for (const run of runs) {
      nodeMap[run.id] = { ...run, children: [] };
    }
    const roots = [];
    for (const run of runs) {
      const parentId = run.metadata?.parentRunId;
      if (parentId && nodeMap[parentId]) {
        nodeMap[parentId].children.push(nodeMap[run.id]);
      } else {
        roots.push(nodeMap[run.id]);
      }
    }

    return res.json({ tree: roots, total: runs.length });
  } catch (error) {
    console.error('[ResearchOps] run-tree failed:', error);
    return res.status(500).json({ error: sanitizeError(error, 'Failed to build run tree') });
  }
});

// Git restore — create a new branch from a specific run's committed state
router.post('/projects/:projectId/git/restore', async (req, res) => {
  try {
    const uid = getUserId(req);
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const runId = String(req.body?.runId || '').trim();
    if (!runId) return res.status(400).json({ error: 'runId is required' });

    const { project, server } = await resolveProjectContext(uid, projectId);
    if (!project.projectPath) return res.status(400).json({ error: 'Project has no projectPath configured' });

    const run = await researchOpsStore.getRun(uid, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    // Prefer the SHA stored in run metadata; fall back to git ref lookup
    let resolvedCommit = String(run.metadata?.gitAppliedCommit || run.metadata?.gitWorktreeCommit || '').trim();

    if (!resolvedCommit) {
      if (server?.id && server.id !== 'local-default') {
        return res.status(400).json({ error: 'Git restore via SSH is not supported yet; run must have git metadata stored' });
      }
      // Try resolving from the git namespace ref directly
      try {
        const result = await runCommand('git', [
          '-C', project.projectPath,
          'rev-parse', `refs/researchops/runs/${runId}/head`,
        ], { timeoutMs: 15000 });
        resolvedCommit = String(result.stdout || '').trim().split(/\r?\n/)[0];
      } catch {
        return res.status(404).json({ error: 'No git state found for this run. Run may not have had git tracking enabled.' });
      }
    }

    if (!resolvedCommit) {
      return res.status(404).json({ error: 'Could not resolve git commit for this run' });
    }

    const safeSuffix = runId.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 12);
    const branch = String(req.body?.branch || `restore/run-${safeSuffix}`).trim().replace(/\s+/g, '-');

    try {
      await runCommand('git', [
        '-C', project.projectPath,
        'checkout', '-b', branch, resolvedCommit,
      ], { timeoutMs: 30000 });
    } catch (gitErr) {
      return res.status(400).json({ error: `git checkout failed: ${String(gitErr.message || gitErr).slice(0, 200)}` });
    }

    return res.json({ ok: true, branch, commit: resolvedCommit, runId });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    console.error('[ResearchOps] git/restore failed:', error);
    return res.status(500).json({ error: sanitizeError(error, 'Git restore failed') });
  }
});

// Autopilot (project-scoped)
router.post('/projects/:projectId/autopilot/start', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const proposal = String(req.body?.proposal || '').trim();
    if (!proposal) return res.status(400).json({ error: 'proposal is required' });
    const maxIterations = Math.min(Math.max(1, Number(req.body?.maxIterations) || 10), 50);
    const serverId = String(req.body?.serverId || 'local-default').trim();
    const skill = String(req.body?.skill || 'implement').trim();
    const userId = getUserId(req);
    const session = await autopilotService.startSession(userId, projectId, {
      proposal, maxIterations, serverId, skill,
    });
    return res.status(201).json({ session });
  } catch (error) {
    console.error('[Autopilot] start failed:', error);
    return res.status(400).json({ error: sanitizeError(error, 'Failed to start autopilot session') });
  }
});

router.get('/projects/:projectId/autopilot/sessions', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const userId = getUserId(req);
    const sessions = autopilotService.listProjectSessions(userId, projectId);
    return res.json({ sessions });
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error, 'Failed to list autopilot sessions') });
  }
});

router.delete('/projects/:projectId/runs', async (req, res) => {
  try {
    const result = await researchOpsStore.clearProjectRuns(getUserId(req), req.params.projectId, {
      status: req.query.status || '',
    });
    return res.json({ deletedCount: result.deletedCount });
  } catch (error) {
    console.error('[ResearchOps] clearProjectRuns failed:', error);
    res.status(500).json({ error: 'Failed to clear run history' });
  }
});

// ── Tree helper functions ─────────────────────────────────────────────────────

function normalizeNodeStatus(status = '') {
  return String(status || '').trim().toUpperCase();
}

function runStatusToNodeStatus(runStatus = '') {
  const normalized = String(runStatus || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'SUCCEEDED') return 'PASSED';
  if (normalized === 'FAILED' || normalized === 'CANCELLED') return 'FAILED';
  if (normalized === 'RUNNING' || normalized === 'PROVISIONING') return 'RUNNING';
  if (normalized === 'QUEUED') return 'QUEUED';
  return '';
}

function extractNodeCommands(node = {}) {
  const commands = [];
  const raw = Array.isArray(node?.commands) ? node.commands : [];
  raw.forEach((item) => {
    if (typeof item === 'string') {
      const text = String(item || '').trim();
      if (text) commands.push(text);
      return;
    }
    const text = String(item?.run || '').trim();
    if (text) commands.push(text);
  });
  return commands;
}

function buildNodeMaps(plan = {}) {
  const nodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const byId = new Map();
  const children = new Map();
  nodes.forEach((node, index) => {
    const id = String(node?.id || '').trim() || `node_${index + 1}`;
    const normalized = { ...node, id };
    byId.set(id, normalized);
    if (!children.has(id)) children.set(id, []);
  });
  nodes.forEach((node) => {
    const id = String(node?.id || '').trim();
    const parent = String(node?.parent || '').trim();
    if (id && parent && byId.has(parent)) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(id);
    }
  });
  return { nodes, byId, children };
}

function resolveExecutionScopeNodeIds(plan = {}, {
  fromNodeId = '',
  scope = 'active_path',
} = {}) {
  const { nodes, byId, children } = buildNodeMaps(plan);
  if (!nodes.length) return [];
  const selectedId = String(fromNodeId || '').trim();
  const start = selectedId && byId.has(selectedId)
    ? selectedId
    : String(nodes[0]?.id || '').trim();
  if (!start || !byId.has(start)) return [];

  const normalizedScope = String(scope || 'active_path').trim().toLowerCase();
  if (normalizedScope === 'entire_ready' || normalizedScope === 'entire_plan') {
    return nodes.map((node) => String(node.id || '').trim()).filter(Boolean);
  }

  if (normalizedScope === 'subtree_all_branches' || normalizedScope === 'subtree') {
    const queue = [start];
    const visited = new Set();
    const ordered = [];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      ordered.push(current);
      const next = children.get(current) || [];
      next.forEach((id) => queue.push(id));
    }
    return ordered;
  }

  const ordered = [];
  const visited = new Set();
  let cursor = start;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    ordered.push(cursor);
    const node = byId.get(cursor);
    const childIds = children.get(cursor) || [];
    if (!childIds.length) break;
    const preferred = String(node?.activeChild || '').trim();
    const next = preferred && childIds.includes(preferred)
      ? preferred
      : childIds[0];
    cursor = next;
  }
  return ordered;
}

function topologicalOrderForSubset(plan = {}, subsetIds = []) {
  const { byId } = buildNodeMaps(plan);
  const subset = new Set(subsetIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (!subset.size) return [];
  const indegree = new Map();
  const outgoing = new Map();
  subset.forEach((id) => {
    indegree.set(id, 0);
    outgoing.set(id, []);
  });

  subset.forEach((id) => {
    const node = byId.get(id);
    if (!node) return;
    const deps = [];
    const parent = String(node.parent || '').trim();
    if (parent && subset.has(parent)) deps.push(parent);
    const evidenceDeps = Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [];
    evidenceDeps.forEach((depId) => {
      const dep = String(depId || '').trim();
      if (dep && subset.has(dep)) deps.push(dep);
    });
    deps.forEach((dep) => {
      outgoing.get(dep).push(id);
      indegree.set(id, (indegree.get(id) || 0) + 1);
    });
  });

  const queue = [...subset].filter((id) => (indegree.get(id) || 0) === 0);
  const ordered = [];
  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);
    const nextList = outgoing.get(current) || [];
    nextList.forEach((next) => {
      const value = (indegree.get(next) || 0) - 1;
      indegree.set(next, value);
      if (value === 0) queue.push(next);
    });
  }

  if (ordered.length === subset.size) return ordered;
  return [...subset];
}

function getNodeDependencyIds(node = {}) {
  const deps = [];
  const parent = String(node.parent || '').trim();
  if (parent) deps.push(parent);
  const evidenceDeps = Array.isArray(node.evidenceDeps) ? node.evidenceDeps : [];
  evidenceDeps.forEach((dep) => {
    const id = String(dep || '').trim();
    if (id) deps.push(id);
  });
  return deps;
}

function evaluateNodeBlocking(node = {}, treeState = {}) {
  const blockedBy = [];
  const deps = getNodeDependencyIds(node);
  deps.forEach((depId) => {
    const depState = treeState?.nodes?.[depId];
    const depStatus = normalizeNodeStatus(depState?.status);
    if (depStatus !== 'PASSED') {
      blockedBy.push({
        type: 'dependency',
        depId,
        status: depStatus || 'UNKNOWN',
      });
    }
  });
  const checks = Array.isArray(node?.checks) ? node.checks : [];
  checks.forEach((check) => {
    const checkType = String(check?.type || '').trim().toLowerCase();
    if (checkType === 'manual_approve') {
      const manualApproved = Boolean(treeState?.nodes?.[node.id]?.manualApproved);
      if (!manualApproved) {
        blockedBy.push({
          type: 'manual_approve',
          check: String(check?.name || checkType || 'manual_approve'),
          status: 'PENDING',
        });
      }
    }
  });
  return {
    blocked: blockedBy.length > 0,
    blockedBy,
  };
}

async function hydrateTreeStateRunStatuses(userId, treeState = {}) {
  const state = treeStateService.normalizeState(treeState);
  const nodeEntries = Object.entries(state.nodes || {});
  for (const [nodeId, nodeState] of nodeEntries) {
    const runId = String(nodeState?.lastRunId || '').trim();
    if (!runId) continue;
    // eslint-disable-next-line no-await-in-loop
    const run = await researchOpsStore.getRun(userId, runId).catch(() => null);
    if (!run) continue;
    const mapped = runStatusToNodeStatus(run.status);
    if (!mapped) continue;
    state.nodes[nodeId] = {
      ...state.nodes[nodeId],
      status: mapped,
      lastRunStatus: String(run.status || '').trim().toUpperCase(),
      lastRunMessage: String(run.lastMessage || '').trim(),
      lastRunUpdatedAt: String(run.updatedAt || run.endedAt || run.startedAt || ''),
    };
  }
  return state;
}

async function buildRunIntentAndPack({
  userId,
  project,
  node,
  run,
  treeState,
}) {
  const failureSignature = failureSignatureService.normalizeFailureSignature({
    run,
    node,
    state: treeState,
  });
  const runIntent = contextRouterService.buildRunIntent({
    project,
    node,
    state: treeState,
    run,
    failureSignature,
  });
  const routedContext = await contextRouterService.routeContextForIntent({
    userId,
    project,
    runIntent,
    store: researchOpsStore,
  });
  const pack = await contextPackService.buildRoutedContextPack(userId, {
    runId: run.id,
    projectId: project.id,
    runIntent,
    routedContext,
  });
  return { runIntent, routedContext, pack };
}

async function resolveProjectAndTree(req, projectId) {
  const userId = getUserId(req);
  const { project, server } = await resolveProjectContext(userId, projectId);
  const [{ plan, validation }, { state }] = await Promise.all([
    treePlanService.readProjectPlan({ project, server }),
    treeStateService.readProjectState({ project, server }),
  ]);
  const hydratedState = await hydrateTreeStateRunStatuses(userId, state);
  return {
    userId,
    project,
    server,
    plan,
    validation,
    state: hydratedState,
  };
}

function buildFallbackRootNode(project = {}, fallbackMessage = '') {
  const safeMessage = cleanString(fallbackMessage);
  return {
    id: 'baseline_root',
    title: 'Baseline Root: Existing Codebase Achievements',
    kind: 'milestone',
    assumption: [
      'Repository baseline exists and can seed downstream branches.',
      ...(safeMessage ? [`Fallback reason: ${safeMessage}`] : []),
    ],
    target: [
      'Baseline is reviewed before downstream execution.',
    ],
    commands: [],
    checks: [
      {
        name: 'baseline_manual_gate',
        type: 'manual_approve',
      },
    ],
    git: {
      base: 'HEAD',
    },
    ui: {
      generatedBy: 'fallback-root',
      generatedAt: new Date().toISOString(),
      summary: safeMessage || `Auto-generated baseline root for ${cleanString(project?.name) || cleanString(project?.id) || 'project'}.`,
    },
    tags: ['baseline', 'root', 'fallback'],
  };
}

function mergePlanWithRootNode(plan = {}, rootNode = {}, { attachOrphans = true } = {}) {
  const rootId = cleanString(rootNode?.id) || 'baseline_root';
  const existingNodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const withoutRoot = existingNodes.filter((node) => cleanString(node?.id) !== rootId);
  const adjustedNodes = attachOrphans
    ? withoutRoot.map((node) => {
      const parent = cleanString(node?.parent);
      if (parent) return node;
      return {
        ...node,
        parent: rootId,
      };
    })
    : withoutRoot;
  return {
    ...plan,
    vars: {
      ...(plan?.vars && typeof plan.vars === 'object' ? plan.vars : {}),
      baseline_summary: cleanString(rootNode?.ui?.summary || ''),
      baseline_generated_at: new Date().toISOString(),
    },
    nodes: [
      rootNode,
      ...adjustedNodes,
    ],
  };
}

async function ensurePlanRootNode({
  project,
  server,
  plan,
  force = false,
  attachOrphans = true,
  persist = false,
}) {
  const existingNodes = Array.isArray(plan?.nodes) ? plan.nodes : [];
  const hasNodes = existingNodes.length > 0;
  const existingRoot = existingNodes.find((node) => cleanString(node?.id) === 'baseline_root') || null;
  if (!force && hasNodes && existingRoot) {
    const validation = treePlanService.validateProjectPlan(plan).validation;
    return {
      plan,
      validation,
      generated: false,
      rootNode: existingRoot,
      summary: cleanString(existingRoot?.ui?.summary || ''),
      achievements: Array.isArray(existingRoot?.assumption) ? existingRoot.assumption : [],
      degraded: null,
    };
  }
  if (!force && hasNodes && !existingRoot) {
    const validation = treePlanService.validateProjectPlan(plan).validation;
    return {
      plan,
      validation,
      generated: false,
      rootNode: null,
      summary: '',
      achievements: [],
      degraded: null,
    };
  }

  let generated = null;
  let degraded = null;
  try {
    generated = await codebaseAchievementService.summarizeExistingCodebase({ project, server });
  } catch (error) {
    generated = {
      summary: cleanString(error?.message) || 'Fallback root generated without repository snapshot.',
      achievements: ['Repository baseline could not be auto-scanned; manual validation required.'],
      rootNode: buildFallbackRootNode(project, error?.message),
      snapshot: null,
      generatedAt: new Date().toISOString(),
    };
    degraded = {
      enabled: true,
      code: cleanString(error?.code) || 'ROOT_SUMMARY_FALLBACK',
      message: cleanString(error?.message) || 'Failed to summarize codebase, fallback root was generated.',
    };
  }

  const nextPlan = mergePlanWithRootNode(
    plan,
    generated.rootNode || buildFallbackRootNode(project, generated.summary),
    {
      attachOrphans: Boolean(attachOrphans),
    }
  );

  if (persist) {
    const written = await treePlanService.writeProjectPlan({ project, server, plan: nextPlan });
    return {
      plan: written.plan,
      validation: written.validation,
      generated: true,
      rootNode: generated.rootNode,
      summary: generated.summary,
      achievements: Array.isArray(generated.achievements) ? generated.achievements : [],
      degraded: degraded || written.degraded || null,
      snapshot: generated.snapshot || null,
    };
  }

  const validated = treePlanService.validateProjectPlan(nextPlan);
  return {
    plan: validated.plan,
    validation: validated.validation,
    generated: true,
    rootNode: generated.rootNode,
    summary: generated.summary,
    achievements: Array.isArray(generated.achievements) ? generated.achievements : [],
    degraded,
    snapshot: generated.snapshot || null,
  };
}

async function executeTreeNodeRun({
  userId,
  project,
  server,
  node,
  treeState,
  force = false,
  preflightOnly = false,
  runSource = 'run-step',
  searchTrialCount = 1,
  clarifyMessages = [],
}) {
  const state = treeStateService.normalizeState(treeState);
  const blocking = evaluateNodeBlocking(node, state);
  if (!force && blocking.blocked) {
    const error = new Error(`Node ${node.id} is blocked`);
    error.code = 'NODE_BLOCKED';
    error.blockedBy = blocking.blockedBy;
    throw error;
  }

  const commands = extractNodeCommands(node);
  if (node.kind === 'search') {
    if (preflightOnly) {
      return {
        mode: 'preflight',
        nodeId: node.id,
        blockedBy: blocking.blockedBy,
        commands,
      };
    }
    const currentSearch = state.search?.[node.id] || {};
    const nextSearch = await searchExecutorService.enqueueSearchTrials({
      userId,
      project,
      node,
      searchState: currentSearch,
      store: researchOpsStore,
      runner: researchOpsRunner,
      count: searchTrialCount,
    });
    const nextState = treeStateService.setNodeState(state, node.id, {
      status: 'RUNNING',
      kind: 'search',
      updatedAt: new Date().toISOString(),
    });
    nextState.search = {
      ...(nextState.search && typeof nextState.search === 'object' ? nextState.search : {}),
      [node.id]: nextSearch,
    };
    nextState.updatedAt = new Date().toISOString();
    await treeStateService.writeProjectState({ project, server, state: nextState });
    return {
      mode: 'search',
      nodeId: node.id,
      search: nextSearch,
      blockedBy: blocking.blockedBy,
    };
  }

  if (preflightOnly) {
    return {
      mode: 'preflight',
      nodeId: node.id,
      blockedBy: blocking.blockedBy,
      commands,
      runPayloadPreview: {
        runType: 'EXPERIMENT',
        serverId: String(project?.serverId || '').trim() || 'local-default',
        command: commands.join(' && ') || 'echo \"node has no commands\"',
      },
    };
  }

  const joinedCommand = commands.join(' && ') || 'echo "node has no commands"';
  const run = await researchOpsStore.enqueueRun(userId, {
    projectId: project.id,
    serverId: String(project?.serverId || '').trim() || 'local-default',
    runType: 'EXPERIMENT',
    schemaVersion: '2.0',
    skillRefs: [
      {
        id: `skill_${deliverableReportSkillService.SKILL_NAME}`,
        name: deliverableReportSkillService.SKILL_NAME,
      },
    ],
    metadata: {
      nodeId: node.id,
      treeNodeId: node.id,
      runSource,
      planNodeKind: node.kind || 'experiment',
      baseCommit: String(node?.git?.base || 'HEAD').trim(),
      commandCount: commands.length,
      experimentCommand: joinedCommand,
      command: 'bash',
      args: ['-lc', joinedCommand],
      cwd: String(project?.projectPath || '').trim() || undefined,
      ...(clarifyMessages.length > 0 ? { clarifyContext: clarifyMessages } : {}),
    },
  });

  let contextPack = null;
  let runIntentData = null;
  try {
    const context = await buildRunIntentAndPack({
      userId,
      project,
      node,
      run,
      treeState: state,
    });
    runIntentData = context.runIntent;
    contextPack = context.pack;
    await researchOpsStore.patchRunMeta(userId, run.id, {
      runIntent: context.runIntent,
      contextPackRef: {
        generatedAt: context.pack?.generatedAt || new Date().toISOString(),
        storage: context.pack?.storage || null,
      },
    });
  } catch (error) {
    console.warn('[ResearchOps] Failed to build routed context pack for run-step:', error?.message || error);
  }

  try {
    const fallbackRunIntent = runIntentData || contextRouterService.buildRunIntent({
      project,
      node,
      state,
      run,
    });
    const deliverable = await deliverableReportSkillService.createDeliverableReportForRun({
      project,
      server,
      node,
      run,
      runIntent: fallbackRunIntent,
      contextPack,
      treeState: state,
      commands,
    });
    await researchOpsStore.createRunArtifact(userId, run.id, {
      kind: 'deliverable_report',
      title: `Deliverable Report · ${cleanString(node?.title) || cleanString(node?.id)}`,
      path: deliverable.reportPath,
      mimeType: 'text/markdown',
      objectKey: deliverable.objectKey || null,
      objectUrl: deliverable.objectUrl || null,
      metadata: {
        skillName: deliverable.skillName,
        templatePath: deliverable.templatePath,
        guidelinePath: deliverable.guidelinePath,
        uploadedToSsh: String(project?.locationType || '').toLowerCase() === 'ssh',
        inlinePreview: String(deliverable.markdown || '').slice(0, 6000),
      },
    });
    await researchOpsStore.patchRunMeta(userId, run.id, {
      deliverableSkill: deliverable.skillName,
      deliverableReportPath: deliverable.reportPath,
      deliverableReportObjectKey: deliverable.objectKey || '',
    });
  } catch (error) {
    console.warn('[ResearchOps] Failed to generate deliverable report via skill:', error?.message || error);
  }

  await researchOpsRunner.executeRun(userId, run).catch((error) => {
    console.warn('[ResearchOps] executeTreeNodeRun immediate execution warning:', error?.message || error);
  });

  let nextState = treeStateService.setNodeState(state, node.id, {
    status: 'RUNNING',
    lastRunId: run.id,
    lastRunStatus: String(run.status || 'QUEUED').trim().toUpperCase(),
    runSource,
  });
  nextState.runs = {
    ...(nextState.runs && typeof nextState.runs === 'object' ? nextState.runs : {}),
    [run.id]: {
      nodeId: node.id,
      status: 'QUEUED',
      createdAt: run.createdAt || new Date().toISOString(),
    },
  };
  nextState = treeStateService.appendQueueItem(nextState, {
    nodeId: node.id,
    runId: run.id,
    status: 'QUEUED',
    source: runSource,
  });
  await treeStateService.writeProjectState({ project, server, state: nextState });

  return {
    mode: 'run',
    nodeId: node.id,
    run,
    blockedBy: blocking.blockedBy,
    contextPack: contextPack
      ? {
        generatedAt: contextPack.generatedAt,
        storage: contextPack.storage || null,
      }
      : null,
  };
}

// ── Tree routes ───────────────────────────────────────────────────────────────

router.get('/projects/:projectId/tree/plan', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const bootstrapRoot = parseBoolean(req.query.bootstrapRoot, true);
    const forceRoot = parseBoolean(req.query.forceRoot, false);
    const planRead = await treePlanService.readProjectPlan({ project, server });
    let plan = planRead.plan;
    let validation = planRead.validation;
    let rootSummary = null;
    let degraded = planRead.degraded || null;

    const hasNodes = Array.isArray(plan?.nodes) && plan.nodes.length > 0;
    const looksLikeDefaultBootstrap = hasNodes
      && plan.nodes.length === 1
      && cleanString(plan.nodes[0]?.id) === 'init'
      && cleanString(plan.nodes[0]?.kind).toLowerCase() === 'setup';
    if (forceRoot || (bootstrapRoot && (!hasNodes || looksLikeDefaultBootstrap))) {
      const rooted = await ensurePlanRootNode({
        project,
        server,
        plan,
        force: forceRoot || looksLikeDefaultBootstrap,
        attachOrphans: true,
        persist: true,
      });
      plan = rooted.plan;
      validation = rooted.validation;
      rootSummary = {
        generated: rooted.generated,
        summary: rooted.summary,
        achievements: rooted.achievements,
        rootNodeId: cleanString(rooted.rootNode?.id) || 'baseline_root',
        snapshot: rooted.snapshot || null,
      };
      degraded = degraded || rooted.degraded || null;
    }

    return res.json({
      projectId: project.id,
      plan,
      validation,
      paths: planRead.paths,
      rootSummary,
      degraded,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    return res.status(400).json(toErrorPayload(error, 'Failed to load tree plan'));
  }
});

router.post('/projects/:projectId/tree/root-node', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const force = parseBoolean(req.body?.force, true);
    const attachOrphans = parseBoolean(req.body?.attachOrphans, true);
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const { plan } = await treePlanService.readProjectPlan({ project, server });
    const rooted = await ensurePlanRootNode({
      project,
      server,
      plan,
      force,
      attachOrphans,
      persist: true,
    });
    return res.json({
      projectId: project.id,
      generated: rooted.generated,
      rootNode: rooted.rootNode,
      summary: rooted.summary,
      achievements: rooted.achievements,
      snapshot: rooted.snapshot || null,
      plan: rooted.plan,
      validation: rooted.validation,
      degraded: rooted.degraded || null,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_SERVER_NOT_FOUND') return res.status(404).json(toErrorPayload(error, 'SSH server not found'));
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    return res.status(400).json(toErrorPayload(error, 'Failed to generate root node'));
  }
});

router.put('/projects/:projectId/tree/plan', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const inputPlan = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : req.body;
    if (!inputPlan || typeof inputPlan !== 'object') {
      return res.status(400).json({ error: 'plan payload is required' });
    }
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const result = await treePlanService.writeProjectPlan({ project, server, plan: inputPlan });
    return res.json({
      projectId: project.id,
      plan: result.plan,
      validation: result.validation,
      paths: result.paths,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PLAN_SCHEMA_INVALID') {
      return res.status(400).json({
        ...toErrorPayload(error, 'Plan validation failed'),
        validation: error.validation || null,
      });
    }
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    return res.status(400).json(toErrorPayload(error, 'Failed to save tree plan'));
  }
});

router.post('/projects/:projectId/tree/plan/validate', async (req, res) => {
  try {
    const inputPlan = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : req.body;
    if (!inputPlan || typeof inputPlan !== 'object') {
      return res.status(400).json({ error: 'plan payload is required' });
    }
    const validated = treePlanService.validateProjectPlan(inputPlan);
    return res.json({
      plan: validated.plan,
      validation: validated.validation,
      valid: Boolean(validated.validation?.valid),
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to validate plan'));
  }
});

router.post('/projects/:projectId/tree/plan/patches', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const patches = Array.isArray(req.body?.patches) ? req.body.patches : [];
    if (!patches.length) return res.status(400).json({ error: 'patches must be a non-empty array' });

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const { state } = await treeStateService.readProjectState({ project, server });
    const result = await treePlanService.applyProjectPlanPatches({
      project,
      server,
      patches,
      state,
    });
    return res.json({
      projectId: project.id,
      plan: result.plan,
      validation: result.validation,
      impact: result.impact,
      applied: result.applied,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PLAN_PATCH_CONFLICT') {
      return res.status(409).json({
        ...toErrorPayload(error, 'Plan patch conflict'),
        details: error.details || null,
      });
    }
    if (error.code === 'PLAN_SCHEMA_INVALID') {
      return res.status(400).json({
        ...toErrorPayload(error, 'Plan schema invalid'),
        validation: error.validation || null,
      });
    }
    return res.status(400).json(toErrorPayload(error, 'Failed to apply plan patches'));
  }
});

router.post('/projects/:projectId/tree/plan/impact-preview', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const patches = Array.isArray(req.body?.patches) ? req.body.patches : [];
    if (!patches.length) return res.status(400).json({ error: 'patches must be a non-empty array' });

    const { plan, state } = await resolveProjectAndTree(req, projectId);
    const result = treePlanService.previewPlanImpact({
      basePlan: plan,
      patches,
      state,
    });
    return res.json({
      projectId,
      validation: result.validation,
      impact: result.impact,
      applied: result.applied,
      previewPlan: result.plan,
    });
  } catch (error) {
    if (error.code === 'PLAN_PATCH_CONFLICT') {
      return res.status(409).json({
        ...toErrorPayload(error, 'Plan patch conflict'),
        details: error.details || null,
      });
    }
    return res.status(400).json(toErrorPayload(error, 'Failed to preview plan impact'));
  }
});

router.get('/projects/:projectId/tree/state', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const readState = await treeStateService.readProjectState({ project, server });
    const hydrated = await hydrateTreeStateRunStatuses(getUserId(req), readState.state);
    const written = await treeStateService.writeProjectState({ project, server, state: hydrated });
    const degraded = readState.degraded || written.degraded || null;
    return res.json({
      projectId: project.id,
      state: written.state,
      paths: written.paths,
      degraded,
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    if (error.code === 'SSH_AUTH_FAILED') return res.status(401).json(toErrorPayload(error, 'SSH authentication failed'));
    if (error.code === 'SSH_HOST_UNREACHABLE') return res.status(502).json(toErrorPayload(error, 'SSH target host is unreachable'));
    return res.status(400).json(toErrorPayload(error, 'Failed to load tree state'));
  }
});

router.post('/projects/:projectId/tree/nodes/:nodeId/run-step', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    if (!projectId || !nodeId) return res.status(400).json({ error: 'projectId and nodeId are required' });
    const force = parseBoolean(req.body?.force, false);
    const preflightOnly = parseBoolean(req.body?.preflightOnly, false);
    const searchTrialCount = parseLimit(req.body?.searchTrialCount, 1, 64);
    const clarifyMessages = Array.isArray(req.body?.clarifyMessages) ? req.body.clarifyMessages : [];

    const { userId, project, server, plan, state } = await resolveProjectAndTree(req, projectId);
    const node = (Array.isArray(plan?.nodes) ? plan.nodes : []).find((item) => String(item?.id || '').trim() === nodeId);
    if (!node) return res.status(404).json({ error: `Node not found: ${nodeId}` });

    const result = await executeTreeNodeRun({
      userId,
      project,
      server,
      node,
      treeState: state,
      force,
      preflightOnly,
      runSource: 'run-step',
      searchTrialCount,
      clarifyMessages,
    });
    return res.status(preflightOnly ? 200 : 202).json({
      projectId: project.id,
      nodeId,
      ...result,
    });
  } catch (error) {
    if (error.code === 'NODE_BLOCKED') {
      return res.status(409).json({
        ...toErrorPayload(error, 'Node is blocked'),
        blockedBy: Array.isArray(error.blockedBy) ? error.blockedBy : [],
      });
    }
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    return res.status(400).json(toErrorPayload(error, 'Failed to run node step'));
  }
});

router.post('/projects/:projectId/tree/nodes/:nodeId/approve', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    if (!projectId || !nodeId) return res.status(400).json({ error: 'projectId and nodeId are required' });

    const { project, server } = await resolveProjectAndTree(req, projectId);
    await treeStateService.patchProjectState({
      project,
      server,
      mutate: (state) => treeStateService.setNodeState(state, nodeId, { manualApproved: true }),
    });
    return res.json({ ok: true, nodeId, manualApproved: true });
  } catch (error) {
    if (error.code === 'PROJECT_NOT_FOUND') return res.status(404).json({ error: 'Project not found' });
    return res.status(400).json(toErrorPayload(error, 'Failed to approve node gate'));
  }
});

router.post('/projects/:projectId/tree/run-all', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const fromNodeId = String(req.body?.fromNodeId || '').trim();
    const scope = String(req.body?.scope || 'active_path').trim().toLowerCase();
    const force = parseBoolean(req.body?.force, false);
    const searchTrialCount = parseLimit(req.body?.searchTrialCount, 1, 64);

    const { userId, project, server, plan, state } = await resolveProjectAndTree(req, projectId);
    if (state?.queue?.paused) {
      return res.status(409).json({
        code: 'QUEUE_PAUSED',
        error: 'Queue is paused. Resume before running all steps.',
      });
    }

    const scopedIds = resolveExecutionScopeNodeIds(plan, { fromNodeId, scope });
    const orderedIds = topologicalOrderForSubset(plan, scopedIds);
    const nodeById = new Map((Array.isArray(plan?.nodes) ? plan.nodes : []).map((node) => [String(node.id || '').trim(), node]));

    const queued = [];
    const blocked = [];
    let currentState = treeStateService.normalizeState(state);
    for (const id of orderedIds) {
      const node = nodeById.get(id);
      if (!node) continue;
      const blockInfo = evaluateNodeBlocking(node, currentState);
      if (!force && blockInfo.blocked) {
        blocked.push({ nodeId: id, blockedBy: blockInfo.blockedBy });
        currentState = treeStateService.setNodeState(currentState, id, {
          status: 'BLOCKED',
          blockedBy: blockInfo.blockedBy,
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await executeTreeNodeRun({
        userId,
        project,
        server,
        node,
        treeState: currentState,
        force,
        preflightOnly: false,
        runSource: 'run-all',
        searchTrialCount,
      });
      queued.push({
        nodeId: id,
        mode: result.mode,
        runId: result?.run?.id || null,
      });
      // eslint-disable-next-line no-await-in-loop
      const next = await treeStateService.readProjectState({ project, server });
      currentState = treeStateService.normalizeState(next.state);
    }

    return res.status(202).json({
      projectId: project.id,
      scope,
      fromNodeId: fromNodeId || null,
      queued,
      blocked,
      summary: {
        scopedNodes: orderedIds.length,
        queued: queued.length,
        blocked: blocked.length,
      },
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to run all tree steps'));
  }
});

router.post('/projects/:projectId/tree/control/pause', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const reason = String(req.body?.reason || 'Paused by user').trim();
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const result = await treeStateService.patchProjectState({
      project,
      server,
      mutate: (state) => treeStateService.setQueuePaused(state, true, reason),
    });
    return res.json({
      projectId: project.id,
      state: result.state,
      paused: true,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to pause tree queue'));
  }
});

router.post('/projects/:projectId/tree/control/resume', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const result = await treeStateService.patchProjectState({
      project,
      server,
      mutate: (state) => treeStateService.setQueuePaused(state, false, ''),
    });
    return res.json({
      projectId: project.id,
      state: result.state,
      paused: false,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to resume tree queue'));
  }
});

router.post('/projects/:projectId/tree/control/abort', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const { state } = await treeStateService.readProjectState({ project, server });
    const queueItems = Array.isArray(state?.queue?.items) ? state.queue.items : [];
    const cancelled = [];
    for (const item of queueItems) {
      const runId = String(item?.runId || '').trim();
      if (!runId) continue;
      // eslint-disable-next-line no-await-in-loop
      await researchOpsRunner.cancelRun(getUserId(req), runId).catch(() => null);
      cancelled.push(runId);
    }
    const result = await treeStateService.patchProjectState({
      project,
      server,
      mutate: (current) => {
        const next = treeStateService.setQueuePaused(current, true, 'Aborted by user');
        next.queue.items = [];
        next.updatedAt = new Date().toISOString();
        return next;
      },
    });
    return res.json({
      projectId: project.id,
      state: result.state,
      cancelledRunIds: cancelled,
      cancelledCount: cancelled.length,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to abort tree queue'));
  }
});

router.get('/projects/:projectId/tree/nodes/:nodeId/search', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    if (!projectId || !nodeId) return res.status(400).json({ error: 'projectId and nodeId are required' });
    const refresh = parseBoolean(req.query.refresh, false);

    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const [{ state }, { plan }] = await Promise.all([
      treeStateService.readProjectState({ project, server }),
      treePlanService.readProjectPlan({ project, server }),
    ]);

    const node = (Array.isArray(plan?.nodes) ? plan.nodes : []).find((item) => String(item?.id || '').trim() === nodeId);
    if (!node) return res.status(404).json({ error: `Node not found: ${nodeId}` });

    const currentSearch = state?.search?.[nodeId] || {
      searchNodeId: nodeId,
      algorithm: 'mcts',
      budget: { max_trials: 24, parallel: 4, max_depth: 3, max_gpu_hours: 2 },
      trials: [],
      updatedAt: new Date().toISOString(),
    };
    const nextSearch = refresh
      ? await searchExecutorService.refreshSearchNodeTrials({
        userId: getUserId(req),
        searchNode: currentSearch,
        store: researchOpsStore,
      })
      : currentSearch;

    if (refresh) {
      const nextState = treeStateService.normalizeState(state);
      nextState.search = {
        ...(nextState.search && typeof nextState.search === 'object' ? nextState.search : {}),
        [nodeId]: nextSearch,
      };
      nextState.updatedAt = new Date().toISOString();
      await treeStateService.writeProjectState({ project, server, state: nextState });
    }

    return res.json({
      projectId: project.id,
      nodeId,
      search: nextSearch,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to load node search state'));
  }
});

router.post('/projects/:projectId/tree/nodes/:nodeId/promote/:trialId', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    const trialId = String(req.params.trialId || '').trim();
    const promotedNodeId = String(req.body?.newNodeId || '').trim();
    if (!projectId || !nodeId || !trialId) {
      return res.status(400).json({ error: 'projectId, nodeId and trialId are required' });
    }
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const [{ plan }, { state }] = await Promise.all([
      treePlanService.readProjectPlan({ project, server }),
      treeStateService.readProjectState({ project, server }),
    ]);

    const searchNode = (Array.isArray(plan?.nodes) ? plan.nodes : []).find((item) => String(item?.id || '').trim() === nodeId);
    if (!searchNode) return res.status(404).json({ error: `Node not found: ${nodeId}` });
    const trials = Array.isArray(state?.search?.[nodeId]?.trials) ? state.search[nodeId].trials : [];
    const trial = trials.find((item) => String(item?.id || '').trim() === trialId);
    if (!trial) return res.status(404).json({ error: `Trial not found: ${trialId}` });

    const status = String(trial?.status || '').trim().toUpperCase();
    if (!['PASSED', 'SUCCEEDED'].includes(status)) {
      return res.status(409).json({
        code: 'TRIAL_NOT_PROMOTABLE',
        error: `Only PASSED trial can be promoted (current status: ${status || 'UNKNOWN'})`,
      });
    }

    const patch = searchExecutorService.buildPromotionPatch({
      searchNode,
      trial,
      promotedNodeId,
    });
    const result = await treePlanService.applyProjectPlanPatches({
      project,
      server,
      patches: [patch],
      state,
    });
    return res.json({
      projectId: project.id,
      nodeId,
      trialId,
      promotedNodeId: patch?.node?.id || promotedNodeId,
      plan: result.plan,
      impact: result.impact,
      validation: result.validation,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to promote search trial'));
  }
});

router.get('/runs/:runId/context-pack', async (req, res) => {
  try {
    const runId = String(req.params.runId || '').trim();
    if (!runId) return res.status(400).json({ error: 'runId is required' });
    const userId = getUserId(req);
    const run = await researchOpsStore.getRun(userId, runId);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const project = await researchOpsStore.getProject(userId, run.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const nodeId = String(run?.metadata?.nodeId || run?.metadata?.treeNodeId || '').trim();
    let node = {
      id: nodeId || 'adhoc',
      title: 'Run context',
      kind: 'experiment',
      commands: [{ run: String(run?.metadata?.experimentCommand || '').trim() }],
      checks: [],
      assumption: [],
      target: [],
      git: { base: String(run?.metadata?.baseCommit || 'HEAD').trim() },
    };
    try {
      const { project: resolvedProject, server } = await resolveProjectContext(userId, run.projectId);
      const [{ plan }, { state }] = await Promise.all([
        treePlanService.readProjectPlan({ project: resolvedProject, server }),
        treeStateService.readProjectState({ project: resolvedProject, server }),
      ]);
      if (nodeId) {
        const planNode = (Array.isArray(plan?.nodes) ? plan.nodes : []).find((item) => String(item?.id || '').trim() === nodeId);
        if (planNode) node = planNode;
      }
      const runIntent = contextRouterService.buildRunIntent({
        project,
        node,
        state,
        run,
      });
      const routedContext = await contextRouterService.routeContextForIntent({
        userId,
        project,
        runIntent,
        store: researchOpsStore,
      });
      const pack = await contextPackService.buildRoutedContextPack(userId, {
        runId: run.id,
        projectId: project.id,
        runIntent,
        routedContext,
      });
      return res.json({ pack });
    } catch (innerError) {
      console.warn('[ResearchOps] routed context pack fallback to legacy builder:', innerError?.message || innerError);
      const pack = await contextPackService.buildContextPack(userId, {
        runId: run.id,
        projectId: project.id,
        contextRefs: run.contextRefs || run.metadata?.contextRefs || {},
      });
      return res.json({ pack, mode: 'legacy' });
    }
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to build context pack'));
  }
});

router.get('/projects/:projectId/context/repo-map', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const commit = String(req.query.commit || '').trim();
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const result = await repoMapService.buildRepoMap({
      project,
      server,
      commit,
      force: false,
    });
    return res.json({
      projectId: project.id,
      ...result,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to build repo map'));
  }
});

router.post('/projects/:projectId/context/repo-map/rebuild', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });
    const commit = String(req.body?.commit || '').trim();
    const { project, server } = await resolveProjectContext(getUserId(req), projectId);
    const result = await repoMapService.buildRepoMap({
      project,
      server,
      commit,
      force: true,
    });
    return res.json({
      projectId: project.id,
      ...result,
    });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to rebuild repo map'));
  }
});

// ── Generate a tree node from a TODO item via LLM ────────────────────────────
router.post('/projects/:projectId/tree/nodes/from-todo', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const todo = req.body?.todo;
    if (!todo || typeof todo !== 'object') return res.status(400).json({ error: 'todo is required' });

    const todoTitle = String(todo.title || '').trim();
    const todoHypothesis = String(todo.hypothesis || todo.description || '').trim();
    if (!todoTitle) return res.status(400).json({ error: 'todo.title is required' });

    const parentNodeId = String(req.body?.parentNodeId || '').trim();
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const nodeSchema = `{
  "id": "snake_case_id_2_to_5_words",
  "title": "Human-readable title",
  "kind": "experiment | analysis | knowledge | setup | milestone | patch | search",
  "assumption": ["assumption 1", "assumption 2"],
  "target": ["measurable acceptance criterion 1", "criterion 2"],
  "commands": [{"cmd": "bash or python command", "label": "short label"}],
  "checks": [{"condition": "verification step", "label": "short label"}],
  "tags": ["tag1", "tag2"]
}`;

    const systemContext = `You are a research planning assistant converting TODO items into executable tree nodes for a research automation system.

Return ONLY a single valid JSON object matching this schema:
${nodeSchema}

Rules:
- id: lowercase, underscores only, 2-5 words, unique slug derived from title
- kind: "experiment" for code/model work, "analysis" for data analysis, "knowledge" for literature/study, "setup" for infra/env, "milestone" for checkpoints
- assumption: 1-3 key prerequisites the node assumes are true
- target: 2-4 specific, measurable success criteria
- commands: 1-5 concrete runnable commands (bash, python3, etc.)
- checks: 1-3 post-command verification steps
- Return ONLY the JSON object — no markdown fences, no extra text`;

    let prompt;
    if (messages.length === 0) {
      prompt = `Generate a tree node for this TODO:\n\nTitle: ${todoTitle}${todoHypothesis ? `\n\nHypothesis/Description: ${todoHypothesis}` : ''}`;
    } else {
      const history = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 800)}`)
        .join('\n\n');
      prompt = `TODO:\nTitle: ${todoTitle}${todoHypothesis ? `\nHypothesis: ${todoHypothesis}` : ''}\n\nConversation so far:\n${history}\n\nBased on the above, generate the updated tree node JSON.`;
    }

    const result = await llmService.generateWithFallback(systemContext, prompt);
    const rawText = String(result?.text || '').trim();

    let node = null;
    try { node = JSON.parse(rawText); } catch (_) {}
    if (!node) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) { try { node = JSON.parse(fenceMatch[1].trim()); } catch (_) {} }
    }
    if (!node) {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      if (objMatch) { try { node = JSON.parse(objMatch[0]); } catch (_) {} }
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return res.status(422).json({ error: 'Failed to parse node from LLM output', raw: rawText.slice(0, 500) });
    }

    if (parentNodeId) node.parent = parentNodeId;

    return res.json({ node, provider: result?.provider || 'unknown' });
  } catch (error) {
    return res.status(400).json(toErrorPayload(error, 'Failed to generate node from TODO'));
  }
});

// ── Clarification Q&A before todo→node generation ─────────────────────────
router.post('/projects/:projectId/tree/nodes/from-todo/clarify', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    if (!projectId) return res.status(400).json({ error: 'projectId is required' });

    const todo = req.body?.todo;
    if (!todo?.title) return res.status(400).json({ error: 'todo.title is required' });

    const todoTitle = String(todo.title || '').trim();
    const todoHypothesis = String(todo.hypothesis || todo.description || '').trim();
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const systemContext = `You are a research planning assistant preparing to convert a TODO into an executable research tree node.

Your job: ask ONE short, targeted clarifying question to gather context that will make the generated node more accurate and useful.

Focus on the most important unknown. Good questions cover:
- Whether this references a specific paper or knowledge-base asset (and which one)
- Which codebase files or modules are relevant
- Whether this is an implementation task (coding a design) or an experiment (running/evaluating)
- Dataset or model assumptions for experiment tasks
- Design doc, architecture, or API assumptions for implementation tasks
- Execution environment specifics (GPU, cluster, local)

Ask ONE question at a time. Prefer offering 2-4 concrete multiple-choice options when possible.

When you have enough context to generate a precise node (typically after 2-3 questions), respond with ONLY:
{"done": true}

Otherwise respond with ONLY valid JSON (no markdown fences):
{"question": "...", "options": ["option A", "option B"]}
or if open-ended:
{"question": "...", "options": []}`;

    let prompt;
    if (messages.length === 0) {
      prompt = `TODO to convert:\nTitle: ${todoTitle}${todoHypothesis ? `\nHypothesis: ${todoHypothesis}` : ''}\n\nAsk your first clarifying question.`;
    } else {
      const history = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 600)}`)
        .join('\n\n');
      prompt = `TODO:\nTitle: ${todoTitle}${todoHypothesis ? `\nHypothesis: ${todoHypothesis}` : ''}\n\nConversation so far:\n${history}\n\nAsk the next clarifying question, or respond {"done":true} if you have enough context.`;
    }

    const result = await llmService.generateWithFallback(systemContext, prompt);
    const rawText = String(result?.text || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) try { parsed = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }
    if (!parsed) {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      if (objMatch) try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
    }
    if (!parsed) return res.status(422).json({ error: 'Failed to parse clarification response', raw: rawText.slice(0, 300) });

    return res.json({
      done: parsed.done === true,
      question: parsed.done ? null : String(parsed.question || ''),
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
    });
  } catch (error) {
    console.error('[from-todo/clarify] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ── Clarification Q&A before node execution ────────────────────────────────
router.post('/projects/:projectId/tree/nodes/:nodeId/run-clarify', async (req, res) => {
  try {
    const projectId = String(req.params.projectId || '').trim();
    const nodeId = String(req.params.nodeId || '').trim();
    if (!projectId || !nodeId) return res.status(400).json({ error: 'projectId and nodeId are required' });

    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const { plan } = await resolveProjectAndTree(req, projectId);
    const node = (Array.isArray(plan?.nodes) ? plan.nodes : []).find(
      (n) => String(n?.id || '').trim() === nodeId,
    );
    if (!node) return res.status(404).json({ error: `Node not found: ${nodeId}` });

    const kind = String(node.kind || 'experiment');
    const isImplementation = kind === 'patch' || kind === 'setup' ||
      (kind === 'experiment' && (node.commands || []).some((c) => {
        const cmd = String(c?.cmd || c?.run || '').toLowerCase();
        return cmd.includes('implement') || cmd.includes('write') || cmd.includes('create') || cmd.includes('edit');
      }));

    const kindGuidance = isImplementation
      ? `This is an IMPLEMENTATION node. Focus questions on:
- Which design document or spec should be followed?
- Which existing code files or modules should be modified?
- What APIs, interfaces, or data structures must be respected?
- Are there style/architecture conventions to follow?`
      : kind === 'analysis'
        ? `This is an ANALYSIS node. Focus questions on:
- Which artifacts or result files should be analyzed?
- What metrics or comparisons are expected?
- What format should the output report take?`
        : kind === 'knowledge'
          ? `This is a KNOWLEDGE node. Focus questions on:
- Which specific papers or KB assets are referenced?
- What scope of literature should be covered?
- Are there known gaps to address?`
          : `This is an EXPERIMENT node. Focus questions on:
- What dataset, checkpoint, or baseline should be used?
- What hyperparameters or configurations are expected?
- What compute environment (GPU type, cluster, local) is available?
- Are there known failure modes to watch for?`;

    const commandSummary = (node.commands || [])
      .slice(0, 5)
      .map((c, i) => `  ${i + 1}. ${String(c?.cmd || c?.run || c || '')}`)
      .join('\n');

    const systemContext = `You are a research execution assistant preparing to run a tree node step.

Node: "${node.title}" (kind: ${kind})
Commands to be executed:
${commandSummary || '  (none listed)'}
Assumptions: ${(node.assumption || []).join('; ') || '(none)'}

${kindGuidance}

Ask ONE short clarifying question at a time. Offer 2-4 concrete options when possible.
When you have enough context (typically after 2-3 questions), respond with ONLY: {"done": true}
Otherwise respond with ONLY valid JSON: {"question": "...", "options": ["A", "B"]}`;

    let prompt;
    if (messages.length === 0) {
      prompt = `Ask your first clarifying question before executing this node.`;
    } else {
      const history = messages
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content || '').slice(0, 600)}`)
        .join('\n\n');
      prompt = `Conversation so far:\n${history}\n\nAsk the next question or respond {"done":true}.`;
    }

    const result = await llmService.generateWithFallback(systemContext, prompt);
    const rawText = String(result?.text || '').trim();

    let parsed = null;
    try { parsed = JSON.parse(rawText); } catch (_) {}
    if (!parsed) {
      const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch) try { parsed = JSON.parse(fenceMatch[1].trim()); } catch (_) {}
    }
    if (!parsed) {
      const objMatch = rawText.match(/\{[\s\S]*\}/);
      if (objMatch) try { parsed = JSON.parse(objMatch[0]); } catch (_) {}
    }
    if (!parsed) return res.status(422).json({ error: 'Failed to parse clarification response', raw: rawText.slice(0, 300) });

    return res.json({
      done: parsed.done === true,
      question: parsed.done ? null : String(parsed.question || ''),
      options: Array.isArray(parsed.options) ? parsed.options.map(String) : [],
    });
  } catch (error) {
    console.error('[run-clarify] Error:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
