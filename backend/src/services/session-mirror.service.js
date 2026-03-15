const crypto = require('crypto');
const { getDb } = require('../db');
const sshTransport = require('./ssh-transport.service');

function generateId(prefix) {
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${prefix}-${suffix}`;
}

function shellEscape(value = '') {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

// ─── Server lookup ────────────────────────────────────────────────────────────

async function getServer(serverId) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM ssh_servers WHERE id = ?',
    args: [serverId],
  });
  return result.rows[0] || null;
}

// ─── Create session ───────────────────────────────────────────────────────────

async function createSession(serverId, { agentType = 'claude', cwd = '~', label = '', prompt = '' } = {}) {
  const server = await getServer(serverId);
  if (!server) throw new Error(`SSH server ${serverId} not found`);

  const prefix = agentType === 'codex' ? 'cx' : 'cc';
  const id = generateId(prefix);
  const tmuxName = id;

  // Build the CLI command to run inside tmux
  const cliCmd = agentType === 'codex' ? 'codex' : 'claude';

  // Create tmux session with the agent CLI running inside it
  // Expand ~ to $HOME so tilde isn't treated literally inside single quotes
  const safeCwd = cwd === '~' ? '$HOME' : shellEscape(cwd);
  const script = `
set -e
cd ${safeCwd} 2>/dev/null || cd ~
tmux new-session -d -s ${shellEscape(tmuxName)} ${shellEscape(cliCmd)}
echo "ok"
`;

  await sshTransport.script(server, script, [], { timeoutMs: 15000 });

  // If a prompt was provided, send it as keystrokes to the tmux session
  if (prompt && prompt.trim()) {
    // Small delay to let the CLI start, then send keystrokes
    const sendScript = `
sleep 1
tmux send-keys -t ${shellEscape(tmuxName)} ${shellEscape(prompt.trim())} Enter
`;
    // Fire-and-forget — don't block on this
    sshTransport.script(server, sendScript, [], { timeoutMs: 10000 }).catch(() => {});
  }

  // Insert DB record
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO agent_sessions (id, ssh_server_id, tmux_session_name, agent_type, label, cwd, status, prompt_digest, started_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?)`,
    args: [id, serverId, tmuxName, agentType, label, cwd, (prompt || '').slice(0, 500), now, now, now],
  });

  return { id, tmuxSessionName: tmuxName, agentType, cwd, label, status: 'running', startedAt: now };
}

// ─── Discover remote Claude Code / Codex session files ────────────────────────

async function discoverRemoteSessions(server) {
  // Single SSH call: list all tmux sessions + scan for Claude/Codex session files
  const script = `
# 1. tmux sessions with CWD
echo "===TMUX==="
tmux list-sessions -F '#{session_name}|#{session_created}|#{session_activity}|#{session_attached}' 2>/dev/null || true
echo "===TMUX_PANES==="
tmux list-panes -a -F '#{session_name}|#{pane_current_path}|#{pane_current_command}' 2>/dev/null || true

# 2. Claude Code sessions (compact: last modified, first human message, cwd)
echo "===CLAUDE==="
CLAUDE_DIR="$HOME/.claude/projects"
if [ -d "$CLAUDE_DIR" ]; then
  for f in "$CLAUDE_DIR"/*/session.jsonl; do
    [ -f "$f" ] || continue
    DIR=$(dirname "$f")
    MTIME=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    FIRST_HUMAN=$(head -50 "$f" 2>/dev/null | grep -m1 '"type":"human"' | head -c 500 || true)
    LAST_LINE=$(tail -1 "$f" 2>/dev/null | head -c 500 || true)
    echo "FILE:$f|MTIME:$MTIME|HUMAN:$FIRST_HUMAN|LAST:$LAST_LINE"
  done
fi

# 3. Codex sessions
echo "===CODEX==="
CODEX_DIR="$HOME/.codex/sessions"
if [ -d "$CODEX_DIR" ]; then
  find "$CODEX_DIR" -name '*.jsonl' -type f 2>/dev/null | while read f; do
    MTIME=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0)
    FIRST_HUMAN=$(head -50 "$f" 2>/dev/null | grep -m1 '"type":"human"' | head -c 500 || true)
    LAST_LINE=$(tail -1 "$f" 2>/dev/null | head -c 500 || true)
    echo "FILE:$f|MTIME:$MTIME|HUMAN:$FIRST_HUMAN|LAST:$LAST_LINE"
  done
fi
echo "===END==="
`;

  try {
    const result = await sshTransport.script(server, script, [], { timeoutMs: 20000 });
    return parseDiscoveryOutput(result.stdout || '');
  } catch {
    return { tmuxSessions: [], tmuxPanes: {}, claudeSessions: [], codexSessions: [] };
  }
}

function parseDiscoveryOutput(output) {
  const sections = {};
  let currentSection = null;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('===') && trimmed.endsWith('===')) {
      currentSection = trimmed.replace(/===/g, '');
      if (!sections[currentSection]) sections[currentSection] = [];
      continue;
    }
    if (currentSection && trimmed) {
      sections[currentSection].push(trimmed);
    }
  }

  // Parse tmux sessions
  const tmuxSessions = (sections.TMUX || []).map((line) => {
    const [name, created, activity, attached] = line.split('|');
    return { name, created, activity, attached: attached === '1' };
  });

  // Parse tmux panes (session → cwd + command mapping)
  const tmuxPanes = {};
  for (const line of (sections.TMUX_PANES || [])) {
    const [name, cwd, cmd] = line.split('|');
    if (name) tmuxPanes[name] = { cwd: cwd || '', command: cmd || '' };
  }

  // Parse Claude Code session files
  const claudeSessions = parseSessionFiles(sections.CLAUDE || [], 'claude');

  // Parse Codex session files
  const codexSessions = parseSessionFiles(sections.CODEX || [], 'codex');

  return { tmuxSessions, tmuxPanes, claudeSessions, codexSessions };
}

function parseSessionFiles(lines, provider) {
  return lines.map((line) => {
    const parts = {};
    for (const segment of line.split('|')) {
      const colonIdx = segment.indexOf(':');
      if (colonIdx > 0) {
        const key = segment.slice(0, colonIdx);
        const value = segment.slice(colonIdx + 1);
        parts[key] = value;
      }
    }
    let promptDigest = '';
    let summary = '';
    try {
      if (parts.HUMAN) {
        const obj = JSON.parse(parts.HUMAN);
        promptDigest = (typeof obj.content === 'string' ? obj.content : '').slice(0, 300);
      }
    } catch { /* ignore */ }
    try {
      if (parts.LAST) {
        const obj = JSON.parse(parts.LAST);
        if (obj.type === 'assistant' && typeof obj.content === 'string') {
          summary = obj.content.slice(0, 300);
        }
      }
    } catch { /* ignore */ }

    return {
      file: parts.FILE || '',
      mtime: parts.MTIME ? new Date(parseInt(parts.MTIME, 10) * 1000).toISOString() : null,
      provider,
      promptDigest,
      summary,
    };
  });
}

// ─── List sessions ────────────────────────────────────────────────────────────

async function listSessions(serverId) {
  const server = await getServer(serverId);
  if (!server) throw new Error(`SSH server ${serverId} not found`);

  // Discover everything from the remote in a single SSH call
  const discovery = await discoverRemoteSessions(server);
  const { tmuxSessions, tmuxPanes, claudeSessions, codexSessions } = discovery;

  // Get DB records for this server
  const db = getDb();
  const dbResult = await db.execute({
    sql: 'SELECT * FROM agent_sessions WHERE ssh_server_id = ? ORDER BY updated_at DESC',
    args: [serverId],
  });
  const dbSessions = dbResult.rows;

  const merged = [];
  const dbNameSet = new Set();

  // 1. Merge DB-tracked sessions with live tmux status
  for (const dbRow of dbSessions) {
    dbNameSet.add(dbRow.tmux_session_name);
    const live = tmuxSessions.find((s) => s.name === dbRow.tmux_session_name);
    const pane = tmuxPanes[dbRow.tmux_session_name];
    merged.push({
      ...dbRow,
      status: live ? 'running' : 'stopped',
      attached: live?.attached || false,
      cwd: pane?.cwd || dbRow.cwd,
      source: 'tracked',
    });

    // Update status in DB if changed
    const newStatus = live ? 'running' : 'stopped';
    if (dbRow.status !== newStatus) {
      db.execute({
        sql: 'UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?',
        args: [newStatus, new Date().toISOString(), dbRow.id],
      }).catch(() => {});
    }
  }

  // 2. Add ALL untracked live tmux sessions (not just cc-/cx- prefixed)
  for (const live of tmuxSessions) {
    if (dbNameSet.has(live.name)) continue;
    const pane = tmuxPanes[live.name];
    // Infer agent type from command running in the pane
    let agentType = 'unknown';
    const cmd = (pane?.command || '').toLowerCase();
    if (cmd.includes('claude')) agentType = 'claude';
    else if (cmd.includes('codex')) agentType = 'codex';
    else if (/^cc-/.test(live.name)) agentType = 'claude';
    else if (/^cx-/.test(live.name)) agentType = 'codex';

    merged.push({
      id: `ext-${live.name}`,
      ssh_server_id: serverId,
      tmux_session_name: live.name,
      agent_type: agentType,
      label: '',
      cwd: pane?.cwd || '',
      status: 'running',
      summary: '',
      prompt_digest: '',
      started_at: live.created ? new Date(parseInt(live.created, 10) * 1000).toISOString() : null,
      attached: live.attached,
      source: 'discovered',
      command: pane?.command || '',
    });
  }

  // 3. Append discovered Claude Code session files (not in tmux — historical)
  const allSessionFiles = [...claudeSessions, ...codexSessions];
  // Sort by mtime descending, limit to 50 most recent
  allSessionFiles.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
  for (const sf of allSessionFiles.slice(0, 50)) {
    merged.push({
      id: `file-${sf.provider}-${Buffer.from(sf.file).toString('base64url').slice(0, 16)}`,
      ssh_server_id: serverId,
      tmux_session_name: '',
      agent_type: sf.provider,
      label: '',
      cwd: sf.file,
      status: 'file',
      summary: sf.summary,
      prompt_digest: sf.promptDigest,
      started_at: sf.mtime,
      attached: false,
      source: 'session_file',
      session_file: sf.file,
    });
  }

  return merged;
}

// ─── Get session detail ───────────────────────────────────────────────────────

async function getSession(sessionId) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM agent_sessions WHERE id = ?',
    args: [sessionId],
  });
  const session = result.rows[0];
  if (!session) return null;

  // Check live status
  const server = await getServer(session.ssh_server_id);
  if (server) {
    try {
      await sshTransport.exec(server,
        ['tmux', 'has-session', '-t', session.tmux_session_name],
        { timeoutMs: 10000 },
      );
      session.status = 'running';
    } catch {
      session.status = 'stopped';
    }
  }

  return session;
}

// ─── Kill session ─────────────────────────────────────────────────────────────

async function killSession(sessionId) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM agent_sessions WHERE id = ?',
    args: [sessionId],
  });
  const session = result.rows[0];
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const server = await getServer(session.ssh_server_id);
  if (!server) throw new Error(`SSH server ${session.ssh_server_id} not found`);

  try {
    await sshTransport.exec(server,
      ['tmux', 'kill-session', '-t', session.tmux_session_name],
      { timeoutMs: 10000 },
    );
  } catch {
    // Session might already be dead
  }

  await db.execute({
    sql: 'UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?',
    args: ['stopped', new Date().toISOString(), sessionId],
  });

  return { id: sessionId, status: 'stopped' };
}

// ─── Extract metadata (compressed session info) ──────────────────────────────

async function extractMetadata(serverId, tmuxName) {
  const server = await getServer(serverId);
  if (!server) return null;

  // Get the tmux session's CWD via pane_current_path
  let cwd = '';
  try {
    const cwdResult = await sshTransport.exec(server,
      ['tmux', 'display-message', '-t', tmuxName, '-p', '#{pane_current_path}'],
      { timeoutMs: 10000 },
    );
    cwd = cwdResult.stdout.trim();
  } catch { /* ignore */ }

  if (!cwd) return { cwd: '', summary: '', promptDigest: '' };

  // Try to find and read Claude Code session metadata (last 20 lines)
  const script = `
set -e
CWD=${shellEscape(cwd)}

# Try Claude Code session files
CLAUDE_DIR="$HOME/.claude/projects"
if [ -d "$CLAUDE_DIR" ]; then
  # Find session files whose project path matches
  MATCH=$(grep -rl "$CWD" "$CLAUDE_DIR"/*/session.jsonl 2>/dev/null | head -1 || true)
  if [ -n "$MATCH" ]; then
    echo "PROVIDER:claude"
    echo "FILE:$MATCH"
    echo "---TAIL---"
    tail -20 "$MATCH" 2>/dev/null || true
    exit 0
  fi
fi

# Try Codex session files
CODEX_DIR="$HOME/.codex/sessions"
if [ -d "$CODEX_DIR" ]; then
  MATCH=$(find "$CODEX_DIR" -name '*.jsonl' -newer "$CODEX_DIR" -mmin -60 2>/dev/null | head -1 || true)
  if [ -n "$MATCH" ]; then
    echo "PROVIDER:codex"
    echo "FILE:$MATCH"
    echo "---TAIL---"
    tail -20 "$MATCH" 2>/dev/null || true
    exit 0
  fi
fi

echo "PROVIDER:none"
`;

  let summary = '';
  let promptDigest = '';
  try {
    const result = await sshTransport.script(server, script, [], { timeoutMs: 15000 });
    const output = result.stdout || '';
    const tailIdx = output.indexOf('---TAIL---');
    if (tailIdx >= 0) {
      const tailContent = output.slice(tailIdx + 10).trim();
      // Extract a brief summary from the last lines
      const lines = tailContent.split('\n').filter(Boolean);
      // Try to parse JSONL lines for summary
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'human' && !promptDigest) {
            promptDigest = (typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content)).slice(0, 300);
          }
          if (obj.type === 'assistant' && typeof obj.content === 'string') {
            summary = obj.content.slice(0, 300);
          }
        } catch { /* not JSON */ }
      }
    }
  } catch { /* metadata extraction is best-effort */ }

  return { cwd, summary, promptDigest };
}

// ─── Refresh session metadata ─────────────────────────────────────────────────

async function refreshSession(sessionId) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM agent_sessions WHERE id = ?',
    args: [sessionId],
  });
  const session = result.rows[0];
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const meta = await extractMetadata(session.ssh_server_id, session.tmux_session_name);
  if (meta) {
    const now = new Date().toISOString();
    await db.execute({
      sql: 'UPDATE agent_sessions SET cwd = COALESCE(NULLIF(?, ""), cwd), summary = ?, prompt_digest = COALESCE(NULLIF(?, ""), prompt_digest), updated_at = ? WHERE id = ?',
      args: [meta.cwd, meta.summary, meta.promptDigest, now, sessionId],
    });
  }

  return getSession(sessionId);
}

// ─── Update last_attached_at ──────────────────────────────────────────────────

async function markAttached(sessionId) {
  const db = getDb();
  await db.execute({
    sql: 'UPDATE agent_sessions SET last_attached_at = ?, updated_at = ? WHERE id = ?',
    args: [new Date().toISOString(), new Date().toISOString(), sessionId],
  });
}

// ─── Paginated past sessions (all servers or filtered) ────────────────────────

async function listPastSessions({ serverId = null, limit = 20, cursor = null } = {}) {
  const db = getDb();
  const conditions = [];
  const args = [];

  if (serverId) {
    conditions.push('ssh_server_id = ?');
    args.push(serverId);
  }
  if (cursor) {
    conditions.push('updated_at < ?');
    args.push(cursor);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  args.push(limit + 1); // fetch one extra to detect hasMore

  const result = await db.execute({
    sql: `SELECT a.*, s.name AS server_name, s.host AS server_host, s.user AS server_user
          FROM agent_sessions a
          LEFT JOIN ssh_servers s ON s.id = a.ssh_server_id
          ${where}
          ORDER BY a.updated_at DESC
          LIMIT ?`,
    args,
  });

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const sessions = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = sessions.length > 0 ? sessions[sessions.length - 1].updated_at : null;

  return { sessions, hasMore, nextCursor };
}

// ─── Resume a stopped session ─────────────────────────────────────────────────

async function resumeSession(sessionId) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM agent_sessions WHERE id = ?',
    args: [sessionId],
  });
  const session = result.rows[0];
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const server = await getServer(session.ssh_server_id);
  if (!server) throw new Error(`SSH server ${session.ssh_server_id} not found`);

  // Check if tmux session already exists (maybe it came back)
  try {
    await sshTransport.exec(server,
      ['tmux', 'has-session', '-t', session.tmux_session_name],
      { timeoutMs: 10000 },
    );
    // Already running — just update DB
    const now = new Date().toISOString();
    await db.execute({
      sql: 'UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?',
      args: ['running', now, sessionId],
    });
    return { ...session, status: 'running' };
  } catch {
    // Not running — recreate it
  }

  const cliCmd = session.agent_type === 'codex' ? 'codex' : 'claude';
  const safeCwd = (!session.cwd || session.cwd === '~') ? '$HOME' : shellEscape(session.cwd);

  const script = `
set -e
cd ${safeCwd} 2>/dev/null || cd ~
tmux new-session -d -s ${shellEscape(session.tmux_session_name)} ${shellEscape(cliCmd)}
echo "ok"
`;

  await sshTransport.script(server, script, [], { timeoutMs: 15000 });

  const now = new Date().toISOString();
  await db.execute({
    sql: 'UPDATE agent_sessions SET status = ?, updated_at = ? WHERE id = ?',
    args: ['running', now, sessionId],
  });

  return { ...session, status: 'running' };
}

module.exports = {
  getServer,
  createSession,
  listSessions,
  getSession,
  killSession,
  extractMetadata,
  refreshSession,
  markAttached,
  listPastSessions,
  resumeSession,
};
