/**
 * Agent Session Watcher
 *
 * Reads Claude Code and Codex session files from the local filesystem,
 * parses them into a run-compatible format, and exposes them as "observed sessions"
 * so they appear in Run History without requiring explicit instrumentation.
 *
 * Claude sessions: ~/.claude/projects/{encoded-path}/{uuid}.jsonl
 * Codex sessions:  ~/.codex/sessions/{year}/{month}/{day}/rollout-{ts}-{uuid}.jsonl
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, '.claude', 'projects');
const CODEX_DIR = path.join(HOME, '.codex', 'sessions');
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ACTIVE_WINDOW_MS = 3 * 60 * 1000;      // file modified within 3 min → RUNNING
const SCAN_INTERVAL_MS = 60 * 1000;           // scan every 60s

// id → session object
const sessionCache = new Map();
let scanTimer = null;

// cwd → resolved git root (persistent across scans; small, bounded by number of unique cwds)
const gitRootCache = new Map();

// ─── Git root resolution (check-in mechanism) ─────────────────────────────────

/**
 * Resolve the canonical git repository root for a directory.
 * This is used to precisely match sessions to registered projects:
 * a session whose cwd is a subdirectory of the project (e.g. /project/src)
 * resolves to the same root as the project itself (/project).
 *
 * Result is cached so repeated sessions from the same project only shell out once.
 * Falls back to the raw cwd if git is unavailable or the path is not a repo.
 */
function resolveGitRoot(dirPath) {
  if (!dirPath) return dirPath;
  if (gitRootCache.has(dirPath)) return gitRootCache.get(dirPath);

  let root = dirPath; // fallback
  try {
    const result = spawnSync('git', ['-C', dirPath, 'rev-parse', '--show-toplevel'], {
      timeout: 4000,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      const resolved = String(result.stdout || '').trim();
      if (resolved) root = resolved;
    }
  } catch (_) { /* git unavailable — use cwd as-is */ }

  gitRootCache.set(dirPath, root);
  return root;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeReadLines(filepath) {
  try {
    return fs.readFileSync(filepath, 'utf8').split('\n').filter(Boolean);
  } catch (_) {
    return [];
  }
}

function parseJsonSafe(str) {
  try { return JSON.parse(str); } catch (_) { return null; }
}

// ─── Claude Code parser ───────────────────────────────────────────────────────

function parseClaudeSession(filepath) {
  const lines = safeReadLines(filepath);
  if (lines.length === 0) return null;

  let cwd = null;
  let gitBranch = null;
  let slug = null;
  let firstPrompt = null;
  let startedAt = null;
  let lastTimestamp = null;
  let toolCallCount = 0;

  for (const line of lines) {
    const obj = parseJsonSafe(line);
    if (!obj) continue;
    const { type } = obj;

    if (type === 'user' && !obj.toolUseResult) {
      if (!cwd && obj.cwd) cwd = obj.cwd;
      if (!gitBranch && obj.gitBranch) gitBranch = obj.gitBranch;
      if (!slug && obj.slug) slug = obj.slug;
      if (!startedAt && obj.timestamp) startedAt = obj.timestamp;
      if (!firstPrompt) {
        const content = obj.message?.content;
        if (typeof content === 'string') {
          firstPrompt = content.trim().slice(0, 500);
        } else if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === 'text' && c.text) {
              firstPrompt = c.text.trim().slice(0, 500);
              break;
            }
          }
        }
      }
    }

    if (type === 'assistant') {
      if (obj.timestamp) lastTimestamp = obj.timestamp;
      const content = Array.isArray(obj.message?.content) ? obj.message.content : [];
      toolCallCount += content.filter((c) => c?.type === 'tool_use').length;
    }
  }

  if (!cwd || !firstPrompt) return null;

  const sessionId = path.basename(filepath, '.jsonl');
  let stat;
  try { stat = fs.statSync(filepath); } catch (_) { return null; }
  const isActive = (Date.now() - stat.mtimeMs) < ACTIVE_WINDOW_MS;
  const gitRoot = resolveGitRoot(cwd);

  return {
    id: `claude-${sessionId}`,
    sessionId,
    agentType: 'claude_code',
    provider: 'claude_code',
    cwd,
    gitRoot,
    gitBranch: gitBranch || null,
    title: slug || firstPrompt.slice(0, 80),
    prompt: firstPrompt,
    toolCallCount,
    status: isActive ? 'RUNNING' : 'SUCCEEDED',
    startedAt: startedAt || stat.birthtime.toISOString(),
    endedAt: isActive ? null : (lastTimestamp || stat.mtime.toISOString()),
    updatedAt: stat.mtime.toISOString(),
    sessionFile: filepath,
  };
}

// ─── Codex parser ─────────────────────────────────────────────────────────────

function parseCodexSession(filepath) {
  const lines = safeReadLines(filepath);
  if (lines.length === 0) return null;

  let cwd = null;
  let model = null;
  let summary = null;
  let firstUserMessage = null;
  let startedAt = null;
  let sessionId = null;

  for (const line of lines) {
    const obj = parseJsonSafe(line);
    if (!obj) continue;
    const { type, payload = {}, timestamp } = obj;

    if (type === 'session_meta') {
      if (!cwd && payload.cwd) cwd = payload.cwd;
      if (!model && payload.model_provider) model = payload.model_provider;
      if (!startedAt && timestamp) startedAt = timestamp;
    }

    if (type === 'turn_context') {
      if (!cwd && payload.cwd) cwd = payload.cwd;
      if (!summary && payload.summary) summary = String(payload.summary).trim();
      if (!sessionId && payload.turn_id) sessionId = payload.turn_id;
      if (!startedAt && timestamp) startedAt = timestamp;
    }

    if (type === 'event_msg' && payload.type === 'user_message' && !firstUserMessage) {
      let msg = String(payload.message || '');
      // Strip IDE context preamble
      const bodyStart = msg.indexOf('\n\n');
      if (bodyStart > -1 && msg.startsWith('# Context from my IDE')) {
        msg = msg.slice(bodyStart).trim();
      }
      if (msg) firstUserMessage = msg.slice(0, 500);
    }
  }

  if (!cwd || (!firstUserMessage && !summary)) return null;

  const basename = path.basename(filepath, '.jsonl');
  // rollout-{yyyy-mm-ddThh-mm-ss}-{uuid}.jsonl
  sessionId = sessionId || basename.replace(/^rollout-[\d-T]+?-([0-9a-f-]+)$/, '$1') || basename;

  let stat;
  try { stat = fs.statSync(filepath); } catch (_) { return null; }
  const isActive = (Date.now() - stat.mtimeMs) < ACTIVE_WINDOW_MS;
  const gitRoot = resolveGitRoot(cwd);

  return {
    id: `codex-${sessionId}`,
    sessionId,
    agentType: 'codex',
    provider: 'codex',
    cwd,
    gitRoot,
    title: summary || (firstUserMessage || '').slice(0, 80),
    prompt: firstUserMessage || summary || '',
    model: model || 'openai',
    status: isActive ? 'RUNNING' : 'SUCCEEDED',
    startedAt: startedAt || stat.birthtime.toISOString(),
    endedAt: isActive ? null : stat.mtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    sessionFile: filepath,
  };
}

// ─── Directory scanner ────────────────────────────────────────────────────────

function scanDir(dir, depth, maxDepth, ext, results) {
  if (depth > maxDepth) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, depth + 1, maxDepth, ext, results);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      try {
        const stat = fs.statSync(full);
        if ((Date.now() - stat.mtimeMs) < MAX_AGE_MS) {
          results.push(full);
        }
      } catch (_) { /* skip */ }
    }
  }
}

async function scanAll() {
  const claudeFiles = [];
  if (fs.existsSync(CLAUDE_DIR)) {
    scanDir(CLAUDE_DIR, 0, 2, '.jsonl', claudeFiles);
  }

  const codexFiles = [];
  if (fs.existsSync(CODEX_DIR)) {
    scanDir(CODEX_DIR, 0, 4, '.jsonl', codexFiles);
  }

  const tasks = [
    ...claudeFiles.map((f) => ({ filepath: f, parser: parseClaudeSession })),
    ...codexFiles.map((f) => ({ filepath: f, parser: parseCodexSession })),
  ];

  for (const { filepath, parser } of tasks) {
    try {
      const session = parser(filepath);
      if (session) {
        sessionCache.set(session.id, session);
      }
    } catch (_) { /* skip bad files */ }
  }

  // Evict sessions older than MAX_AGE_MS
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const [id, session] of sessionCache.entries()) {
    const ts = new Date(session.startedAt || 0).getTime();
    if (!Number.isFinite(ts) || ts < cutoff) sessionCache.delete(id);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

function start() {
  scanAll().catch((err) => console.warn('[AgentSessionWatcher] Initial scan error:', err.message));
  scanTimer = setInterval(
    () => scanAll().catch((err) => console.warn('[AgentSessionWatcher] Scan error:', err.message)),
    SCAN_INTERVAL_MS,
  );
  console.log('[AgentSessionWatcher] Watching Claude Code + Codex sessions');
}

function stop() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
}

/**
 * Returns sessions whose resolved git root exactly matches the given projectPath.
 * Using gitRoot (not raw cwd) guarantees we only return sessions that genuinely
 * belong to this project, even when the agent was launched from a subdirectory.
 * Sorted newest-first.
 */
function getSessionsByPath(projectPath) {
  const normalized = String(projectPath || '').replace(/\/+$/, '');
  if (!normalized) return [];
  return [...sessionCache.values()]
    .filter((s) => {
      const root = String(s.gitRoot || s.cwd || '').replace(/\/+$/, '');
      return root === normalized;
    })
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

function getAllSessions() {
  return [...sessionCache.values()]
    .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

module.exports = { start, stop, getSessionsByPath, getAllSessions };
