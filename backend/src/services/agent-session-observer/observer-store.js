'use strict';

const path = require('path');
const fs = require('fs/promises');
const os = require('os');
const { createClient } = require('@libsql/client');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizeDbPath(dbPath = '') {
  const target = cleanString(dbPath);
  return path.resolve(target || path.join(os.homedir(), '.researchops', 'agent-session-observer', 'observer.db'));
}

function normalizeSession(input = {}) {
  return {
    provider: cleanString(input.provider).toLowerCase(),
    sessionId: cleanString(input.sessionId),
    sessionFile: cleanString(input.sessionFile),
    cwd: cleanString(input.cwd),
    gitRoot: cleanString(input.gitRoot),
    title: cleanString(input.title),
    promptDigest: cleanString(input.promptDigest),
    latestProgressDigest: cleanString(input.latestProgressDigest),
    status: cleanString(input.status).toUpperCase() || 'UNKNOWN',
    startedAt: cleanString(input.startedAt),
    updatedAt: cleanString(input.updatedAt),
    lastSize: cleanNumber(input.lastSize, 0),
    lastMtime: cleanNumber(input.lastMtime, 0),
    contentHash: cleanString(input.contentHash),
  };
}

function mapRow(row = {}) {
  if (!row || typeof row !== 'object') return null;
  return {
    provider: cleanString(row.provider).toLowerCase(),
    sessionId: cleanString(row.session_id),
    sessionFile: cleanString(row.session_file),
    cwd: cleanString(row.cwd),
    gitRoot: cleanString(row.git_root),
    title: cleanString(row.title),
    promptDigest: cleanString(row.prompt_digest),
    latestProgressDigest: cleanString(row.latest_progress_digest),
    status: cleanString(row.status).toUpperCase() || 'UNKNOWN',
    startedAt: cleanString(row.started_at),
    updatedAt: cleanString(row.updated_at),
    lastSize: cleanNumber(row.last_size, 0),
    lastMtime: cleanNumber(row.last_mtime, 0),
    contentHash: cleanString(row.content_hash),
  };
}

async function ensureSchema(client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS observed_sessions (
      session_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      session_file TEXT NOT NULL,
      cwd TEXT NOT NULL,
      git_root TEXT NOT NULL,
      title TEXT NOT NULL,
      prompt_digest TEXT NOT NULL,
      latest_progress_digest TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_size INTEGER NOT NULL DEFAULT 0,
      last_mtime INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT NOT NULL DEFAULT ''
    )
  `);
  await client.execute('CREATE INDEX IF NOT EXISTS idx_observed_sessions_git_root ON observed_sessions (git_root, updated_at DESC)');
}

async function createObserverStore({ dbPath = '' } = {}) {
  const resolvedDbPath = normalizeDbPath(dbPath);
  await fs.mkdir(path.dirname(resolvedDbPath), { recursive: true });
  const client = createClient({ url: `file:${resolvedDbPath}` });
  await ensureSchema(client);

  return {
    dbPath: resolvedDbPath,

    async upsertSession(input = {}) {
      const session = normalizeSession(input);
      if (!session.sessionId) throw new Error('sessionId is required');
      if (!session.sessionFile) throw new Error('sessionFile is required');
      if (!session.gitRoot) throw new Error('gitRoot is required');
      await client.execute({
        sql: `
          INSERT INTO observed_sessions (
            session_id, provider, session_file, cwd, git_root, title, prompt_digest,
            latest_progress_digest, status, started_at, updated_at, last_size, last_mtime, content_hash
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            provider = excluded.provider,
            session_file = excluded.session_file,
            cwd = excluded.cwd,
            git_root = excluded.git_root,
            title = excluded.title,
            prompt_digest = excluded.prompt_digest,
            latest_progress_digest = excluded.latest_progress_digest,
            status = excluded.status,
            started_at = excluded.started_at,
            updated_at = excluded.updated_at,
            last_size = excluded.last_size,
            last_mtime = excluded.last_mtime,
            content_hash = excluded.content_hash
        `,
        args: [
          session.sessionId,
          session.provider,
          session.sessionFile,
          session.cwd,
          session.gitRoot,
          session.title,
          session.promptDigest,
          session.latestProgressDigest,
          session.status,
          session.startedAt,
          session.updatedAt,
          session.lastSize,
          session.lastMtime,
          session.contentHash,
        ],
      });
      return session;
    },

    async listSessionsByGitRoot(gitRoot = '') {
      const target = cleanString(gitRoot);
      if (!target) return [];
      const result = await client.execute({
        sql: `
          SELECT session_id, provider, session_file, cwd, git_root, title, prompt_digest,
                 latest_progress_digest, status, started_at, updated_at, last_size, last_mtime, content_hash
          FROM observed_sessions
          WHERE git_root = ?
          ORDER BY updated_at DESC, session_id DESC
        `,
        args: [target],
      });
      return (Array.isArray(result.rows) ? result.rows : []).map(mapRow).filter(Boolean);
    },

    async getSessionById(sessionId = '') {
      const target = cleanString(sessionId);
      if (!target) return null;
      const result = await client.execute({
        sql: `
          SELECT session_id, provider, session_file, cwd, git_root, title, prompt_digest,
                 latest_progress_digest, status, started_at, updated_at, last_size, last_mtime, content_hash
          FROM observed_sessions
          WHERE session_id = ?
          LIMIT 1
        `,
        args: [target],
      });
      return mapRow(result.rows?.[0] || null);
    },

    async getSessionByFile(sessionFile = '') {
      const target = cleanString(sessionFile);
      if (!target) return null;
      const result = await client.execute({
        sql: `
          SELECT session_id, provider, session_file, cwd, git_root, title, prompt_digest,
                 latest_progress_digest, status, started_at, updated_at, last_size, last_mtime, content_hash
          FROM observed_sessions
          WHERE session_file = ?
          LIMIT 1
        `,
        args: [target],
      });
      return mapRow(result.rows?.[0] || null);
    },

    async close() {
      client.close();
    },
  };
}

module.exports = {
  createObserverStore,
  normalizeSession,
};
