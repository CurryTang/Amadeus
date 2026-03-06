'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseJsonSafe(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

function sha1(value = '') {
  return crypto.createHash('sha1').update(String(value || ''), 'utf8').digest('hex');
}

function resolveGitRootDefault(dirPath = '') {
  const target = cleanString(dirPath);
  if (!target) return '';
  try {
    const result = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
      timeout: 4000,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      const resolved = cleanString(result.stdout);
      if (resolved) return resolved;
    }
  } catch (_) {
    // ignore
  }
  return target;
}

function readLines(text = '') {
  return String(text || '').split('\n').filter(Boolean);
}

function resolveMemoizedGitRoot(cwd = '', { resolveGitRootFn = resolveGitRootDefault, gitRootCache = new Map() } = {}) {
  const target = cleanString(cwd);
  if (!target) return '';
  if (gitRootCache.has(target)) return gitRootCache.get(target);
  const resolved = cleanString(resolveGitRootFn(target)) || target;
  gitRootCache.set(target, resolved);
  return resolved;
}

function parseClaudeSessionContent(filepath, text, context = {}) {
  const lines = readLines(text);
  if (!lines.length) return null;

  let cwd = '';
  let gitBranch = '';
  let slug = '';
  let firstPrompt = '';
  let startedAt = '';
  let lastTimestamp = '';
  let latestProgressDigest = '';
  let toolCallCount = 0;

  for (const line of lines) {
    const obj = parseJsonSafe(line);
    if (!obj) continue;
    if (obj.type === 'user' && !obj.toolUseResult) {
      if (!cwd) cwd = cleanString(obj.cwd);
      if (!gitBranch) gitBranch = cleanString(obj.gitBranch);
      if (!slug) slug = cleanString(obj.slug);
      if (!startedAt) startedAt = cleanString(obj.timestamp);
      if (!firstPrompt) {
        const content = obj.message?.content;
        if (typeof content === 'string') {
          firstPrompt = cleanString(content).slice(0, 500);
        } else if (Array.isArray(content)) {
          const textPart = content.find((item) => item?.type === 'text' && cleanString(item.text));
          if (textPart) firstPrompt = cleanString(textPart.text).slice(0, 500);
        }
      }
    }
    if (obj.type === 'assistant') {
      lastTimestamp = cleanString(obj.timestamp) || lastTimestamp;
      const content = Array.isArray(obj.message?.content) ? obj.message.content : [];
      const textPart = content.find((item) => item?.type === 'text' && cleanString(item.text));
      if (textPart) latestProgressDigest = cleanString(textPart.text).slice(0, 240);
      toolCallCount += content.filter((item) => item?.type === 'tool_use').length;
    }
  }

  if (!cwd || !firstPrompt) return null;
  const stat = fs.statSync(filepath);
  const gitRoot = resolveMemoizedGitRoot(cwd, context);
  const sessionId = cleanString(path.basename(filepath, '.jsonl'));
  const updatedAt = stat.mtime.toISOString();
  const active = (Date.now() - stat.mtimeMs) < (3 * 60 * 1000);

  return {
    provider: 'claude_code',
    sessionId,
    sessionFile: filepath,
    cwd,
    gitRoot,
    title: slug || firstPrompt.slice(0, 80),
    promptDigest: firstPrompt,
    latestProgressDigest: latestProgressDigest || firstPrompt.slice(0, 240),
    status: active ? 'RUNNING' : 'SUCCEEDED',
    startedAt: startedAt || stat.birthtime.toISOString(),
    updatedAt,
    endedAt: active ? '' : (lastTimestamp || updatedAt),
    gitBranch: gitBranch || '',
    toolCallCount,
    lastSize: stat.size,
    lastMtime: Math.floor(stat.mtimeMs),
    contentHash: sha1(text),
  };
}

function parseCodexSessionContent(filepath, text, context = {}) {
  const lines = readLines(text);
  if (!lines.length) return null;

  let cwd = '';
  let model = '';
  let summary = '';
  let firstUserMessage = '';
  let startedAt = '';
  let sessionId = '';
  let latestProgressDigest = '';

  for (const line of lines) {
    const obj = parseJsonSafe(line);
    if (!obj) continue;
    const payload = obj.payload && typeof obj.payload === 'object' ? obj.payload : {};
    if (obj.type === 'session_meta') {
      if (!cwd) cwd = cleanString(payload.cwd);
      if (!model) model = cleanString(payload.model_provider);
      if (!startedAt) startedAt = cleanString(obj.timestamp);
    }
    if (obj.type === 'turn_context') {
      if (!cwd) cwd = cleanString(payload.cwd);
      if (!summary) summary = cleanString(payload.summary);
      latestProgressDigest = cleanString(payload.summary) || latestProgressDigest;
      if (!sessionId) sessionId = cleanString(payload.turn_id);
      if (!startedAt) startedAt = cleanString(obj.timestamp);
    }
    if (obj.type === 'event_msg' && payload.type === 'user_message' && !firstUserMessage) {
      let message = cleanString(payload.message);
      const bodyStart = message.indexOf('\n\n');
      if (bodyStart > -1 && message.startsWith('# Context from my IDE')) {
        message = cleanString(message.slice(bodyStart));
      }
      if (message) firstUserMessage = message.slice(0, 500);
    }
  }

  if (!cwd || (!firstUserMessage && !summary)) return null;
  const stat = fs.statSync(filepath);
  const gitRoot = resolveMemoizedGitRoot(cwd, context);
  const basename = cleanString(path.basename(filepath, '.jsonl'));
  const updatedAt = stat.mtime.toISOString();
  const active = (Date.now() - stat.mtimeMs) < (3 * 60 * 1000);

  return {
    provider: 'codex',
    sessionId: basename,
    sessionFile: filepath,
    cwd,
    gitRoot,
    title: summary || (firstUserMessage || '').slice(0, 80),
    promptDigest: firstUserMessage || summary || '',
    latestProgressDigest: latestProgressDigest || summary || firstUserMessage.slice(0, 240),
    status: active ? 'RUNNING' : 'SUCCEEDED',
    startedAt: startedAt || stat.birthtime.toISOString(),
    updatedAt,
    endedAt: active ? '' : updatedAt,
    model: model || 'openai',
    lastSize: stat.size,
    lastMtime: Math.floor(stat.mtimeMs),
    contentHash: sha1(text),
  };
}

async function parseSessionFile(filepath, context = {}) {
  const text = await fsp.readFile(filepath, 'utf8');
  const lines = readLines(text);
  const firstObjects = lines.slice(0, 8).map(parseJsonSafe).filter(Boolean);
  const looksCodex = firstObjects.some((obj) => ['session_meta', 'turn_context', 'event_msg'].includes(cleanString(obj?.type)));
  if (looksCodex) return parseCodexSessionContent(filepath, text, context);
  return parseClaudeSessionContent(filepath, text, context);
}

function scanDir(dir, depth, maxDepth, results) {
  if (depth > maxDepth) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(full, depth + 1, maxDepth, results);
      return;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  });
}

async function listSessionFiles() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const codexDir = path.join(os.homedir(), '.codex', 'sessions');
  const results = [];
  if (fs.existsSync(claudeDir)) scanDir(claudeDir, 0, 2, results);
  if (fs.existsSync(codexDir)) scanDir(codexDir, 0, 4, results);
  return results;
}

async function runObserverIndexTick({
  store,
  state = null,
  listSessionFilesFn = listSessionFiles,
  parseSessionFileFn = parseSessionFile,
  resolveGitRootFn = resolveGitRootDefault,
} = {}) {
  if (!store || typeof store.upsertSession !== 'function') {
    throw new Error('store with upsertSession is required');
  }
  const nextState = {
    files: { ...(state?.files && typeof state.files === 'object' ? state.files : {}) },
    gitRoots: new Map(state?.gitRoots instanceof Map ? state.gitRoots : []),
  };
  const listed = await listSessionFilesFn();
  const filepaths = Array.isArray(listed) ? listed : [];
  const seen = new Set();

  for (const filepath of filepaths) {
    const full = cleanString(filepath);
    if (!full) continue;
    seen.add(full);
    let stat = null;
    try {
      stat = await fsp.stat(full);
    } catch (_) {
      continue;
    }
    const fingerprint = `${Math.floor(stat.mtimeMs)}:${stat.size}`;
    const persisted = typeof store.getSessionByFile === 'function'
      ? await store.getSessionByFile(full)
      : null;
    if (
      nextState.files[full]?.fingerprint === fingerprint
      || (persisted && Number(persisted.lastMtime) === Math.floor(stat.mtimeMs) && Number(persisted.lastSize) === stat.size)
    ) {
      nextState.files[full] = {
        fingerprint,
        sessionId: persisted?.sessionId || nextState.files[full]?.sessionId || '',
      };
      continue;
    }

    const parsed = await parseSessionFileFn(full, {
      resolveGitRootFn,
      gitRootCache: nextState.gitRoots,
    });
    if (!parsed) continue;
    await store.upsertSession(parsed);
    nextState.files[full] = {
      fingerprint,
      sessionId: parsed.sessionId,
    };
  }

  Object.keys(nextState.files).forEach((filepath) => {
    if (!seen.has(filepath)) delete nextState.files[filepath];
  });

  return nextState;
}

module.exports = {
  parseSessionFile,
  parseClaudeSessionContent,
  parseCodexSessionContent,
  resolveGitRootDefault,
  runObserverIndexTick,
  listSessionFiles,
};
