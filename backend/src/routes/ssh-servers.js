const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');
const keypairService = require('../services/keypair.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 }, // 512 KB is enough for SSH config files
});

// ─── Helpers ───────────────────────────────────────────────────────────────

function expandHome(p) {
  return (p || '').replace(/^~/, os.homedir());
}

function parseSshConfig(content) {
  const hosts = [];
  let current = null;
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const spaceIdx = line.search(/\s/);
    if (spaceIdx === -1) continue;
    const key = line.slice(0, spaceIdx).toLowerCase();
    const value = line.slice(spaceIdx).trim();
    if (key === 'host') {
      if (current && current.alias !== '*') hosts.push(current);
      current = {
        alias: value,
        host: value,
        user: '',
        port: 22,
        identityFile: '~/.ssh/id_rsa',
        proxyJump: '',
      };
    } else if (current) {
      if (key === 'hostname') current.host = value;
      else if (key === 'user') current.user = value;
      else if (key === 'port') current.port = parseInt(value) || 22;
      else if (key === 'identityfile') current.identityFile = value;
      else if (key === 'proxyjump') current.proxyJump = value;
    }
  }
  if (current && current.alias !== '*') hosts.push(current);
  return hosts;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeRemotePath(input = '') {
  return String(input || '').trim();
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizePeerIds(value, { selfId = '' } = {}) {
  const blockedId = String(selfId || '').trim();
  const seen = new Set();
  const out = [];
  for (const item of parseJsonArray(value)) {
    const normalized = String(item ?? '').trim();
    if (!normalized) continue;
    if (blockedId && normalized === blockedId) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function sameStringArray(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function resolveProbePath(server = {}) {
  const remotePath = normalizeRemotePath(server.shared_fs_remote_path);
  const localPath = normalizeRemotePath(server.shared_fs_local_path);
  return remotePath || localPath || '~';
}

function sharedFsFromServer(server = {}) {
  const enabled = Number(server.shared_fs_enabled) === 1;
  const peers = normalizePeerIds(server.shared_fs_peers);
  const verifiedPeers = normalizePeerIds(server.shared_fs_verified_peers);
  const probePath = resolveProbePath(server);
  return { enabled, peers, verifiedPeers, probePath };
}

function resolveSharedFsConfig(payload = {}, defaults = {}, { selfId = '' } = {}) {
  const enabled = parseBoolean(
    payload.shared_fs_enabled ?? payload.sharedFsEnabled,
    Boolean(defaults.enabled)
  );
  const peers = normalizePeerIds(
    payload.shared_fs_peers ?? payload.sharedFsPeers ?? defaults.peers,
    { selfId }
  );
  const probePath = normalizeRemotePath(
    payload.shared_fs_probe_path ?? payload.sharedFsProbePath ?? defaults.probePath
  ) || '~';
  if (!enabled) {
    return {
      enabled: false,
      peers: [],
      verifiedPeers: [],
      probePath: '~',
    };
  }
  return { enabled, peers, verifiedPeers: [], probePath };
}

function buildSshArgs(server, { connectTimeout = 10 } = {}) {
  const keyPath = keypairService.MANAGED_KEY_PATH;
  const sshArgs = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server.port || 22),
  ];
  if (String(server.proxy_jump || '').trim()) {
    sshArgs.push('-J', String(server.proxy_jump).trim());
  }
  sshArgs.push(`${server.user}@${server.host}`);
  return sshArgs;
}

function runSshCommand(server, commandArgs = [], { timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const sshArgs = [...buildSshArgs(server), ...commandArgs];
    const proc = spawn('ssh', sshArgs, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`ssh command timed out after ${timeoutMs}ms`));
      }
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(stderr.trim() || `exit code ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.message));
    });
  });
}

function runSshBashScript(server, script, scriptArgs = [], { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const sshArgs = [
      ...buildSshArgs(server, { connectTimeout: 15 }),
      'bash',
      '-s',
      '--',
      ...scriptArgs.map((value) => String(value ?? '')),
    ];
    const proc = spawn('ssh', sshArgs, {
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        return reject(new Error(`ssh script timed out after ${timeoutMs}ms`));
      }
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(stderr.trim() || `exit code ${code}`));
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(err.message));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(String(script || ''));
  });
}

async function updateSharedFsCheckStatus(db, serverId, { verifiedPeers = [], status }) {
  const normalizedVerifiedPeers = normalizePeerIds(verifiedPeers);
  await db.execute({
    sql: `
      UPDATE ssh_servers
      SET shared_fs_verified = ?,
          shared_fs_verified_peers = ?,
          shared_fs_last_checked_at = CURRENT_TIMESTAMP,
          shared_fs_last_status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    args: [
      normalizedVerifiedPeers.length > 0 ? 1 : 0,
      JSON.stringify(normalizedVerifiedPeers),
      String(status || ''),
      serverId,
    ],
  });
}

async function verifySharedFilesystemPair(sourceServer, targetServer, sourcePath, targetPath) {
  const sourceDir = normalizeRemotePath(sourcePath);
  const targetDir = normalizeRemotePath(targetPath);
  if (!sourceDir || !targetDir) {
    throw new Error('Both source and target shared filesystem paths are required');
  }

  const nonce = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const sourceMarkerName = `.vibe-sfs-src-${nonce}.txt`;
  const targetMarkerName = `.vibe-sfs-target-${nonce}.txt`;
  const sourceToken = `src-visible-${nonce}`;
  const targetToken = `target-visible-${nonce}`;

  const sourceWriteScript = [
    'set -eu',
    'SRC_DIR="$1"',
    'SRC_MARKER="$2"',
    'SRC_TOKEN="$3"',
    'case "$SRC_DIR" in',
    "  '~'|'~/'*) SRC_DIR=\"$HOME${SRC_DIR#\\~}\" ;;",
    'esac',
    'if [ ! -d "$SRC_DIR" ]; then',
    '  echo "Source path is not a directory: $SRC_DIR" >&2',
    '  exit 31',
    'fi',
    'printf "%s" "$SRC_TOKEN" > "$SRC_DIR/$SRC_MARKER"',
    '',
  ].join('\n');

  const targetCheckScript = [
    'set -eu',
    'TARGET_DIR="$1"',
    'SRC_MARKER="$2"',
    'TARGET_MARKER="$3"',
    'EXPECT_SRC_TOKEN="$4"',
    'TARGET_TOKEN="$5"',
    'case "$TARGET_DIR" in',
    "  '~'|'~/'*) TARGET_DIR=\"$HOME${TARGET_DIR#\\~}\" ;;",
    'esac',
    'if [ ! -d "$TARGET_DIR" ]; then',
    '  echo "Target path is not a directory: $TARGET_DIR" >&2',
    '  exit 41',
    'fi',
    'if [ ! -f "$TARGET_DIR/$SRC_MARKER" ]; then',
    '  echo "Target server cannot see source marker: $TARGET_DIR/$SRC_MARKER" >&2',
    '  exit 42',
    'fi',
    'SEEN_SRC_TOKEN="$(cat "$TARGET_DIR/$SRC_MARKER")"',
    'if [ "$SEEN_SRC_TOKEN" != "$EXPECT_SRC_TOKEN" ]; then',
    '  echo "Source marker token mismatch on target side" >&2',
    '  exit 43',
    'fi',
    'printf "%s" "$TARGET_TOKEN" > "$TARGET_DIR/$TARGET_MARKER"',
    '',
  ].join('\n');

  const sourceReadScript = [
    'set -eu',
    'SRC_DIR="$1"',
    'TARGET_MARKER="$2"',
    'EXPECT_TARGET_TOKEN="$3"',
    'case "$SRC_DIR" in',
    "  '~'|'~/'*) SRC_DIR=\"$HOME${SRC_DIR#\\~}\" ;;",
    'esac',
    'if [ ! -f "$SRC_DIR/$TARGET_MARKER" ]; then',
    '  echo "Source server cannot see target marker: $SRC_DIR/$TARGET_MARKER" >&2',
    '  exit 51',
    'fi',
    'SEEN_TARGET_TOKEN="$(cat "$SRC_DIR/$TARGET_MARKER")"',
    'if [ "$SEEN_TARGET_TOKEN" != "$EXPECT_TARGET_TOKEN" ]; then',
    '  echo "Target marker token mismatch on source side" >&2',
    '  exit 52',
    'fi',
    '',
  ].join('\n');

  const cleanupScript = [
    'set +e',
    'DIR_PATH="$1"',
    'SRC_MARKER="$2"',
    'TARGET_MARKER="$3"',
    'case "$DIR_PATH" in',
    "  '~'|'~/'*) DIR_PATH=\"$HOME${DIR_PATH#\\~}\" ;;",
    'esac',
    'rm -f "$DIR_PATH/$SRC_MARKER" "$DIR_PATH/$TARGET_MARKER" >/dev/null 2>&1 || true',
    '',
  ].join('\n');

  try {
    await runSshBashScript(
      sourceServer,
      sourceWriteScript,
      [sourceDir, sourceMarkerName, sourceToken],
      { timeoutMs: 30000 }
    );

    await runSshBashScript(
      targetServer,
      targetCheckScript,
      [targetDir, sourceMarkerName, targetMarkerName, sourceToken, targetToken],
      { timeoutMs: 30000 }
    );

    await runSshBashScript(
      sourceServer,
      sourceReadScript,
      [sourceDir, targetMarkerName, targetToken],
      { timeoutMs: 30000 }
    );

    return {
      sourceServerId: String(sourceServer.id),
      targetServerId: String(targetServer.id),
      sourcePath: sourceDir,
      targetPath: targetDir,
      message: 'Shared filesystem verified between servers (bi-directional marker check passed)',
    };
  } finally {
    try {
      await runSshBashScript(
        sourceServer,
        cleanupScript,
        [sourceDir, sourceMarkerName, targetMarkerName],
        { timeoutMs: 8000 }
      );
    } catch (_) {}
    try {
      await runSshBashScript(
        targetServer,
        cleanupScript,
        [targetDir, sourceMarkerName, targetMarkerName],
        { timeoutMs: 8000 }
      );
    } catch (_) {}
  }
}

// ─── CRUD ──────────────────────────────────────────────────────────────────

// GET /api/ssh-servers - List all configured servers
router.get('/', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.execute(`SELECT * FROM ssh_servers ORDER BY name`);
    res.json({ servers: result.rows });
  } catch (err) {
    console.error('Error fetching SSH servers:', err);
    res.status(500).json({ error: 'Failed to fetch SSH servers' });
  }
});

// POST /api/ssh-servers - Create a new server
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      name,
      host,
      user,
      username,
      port = 22,
      ssh_key_path = '~/.ssh/id_rsa',
      proxy_jump,
      proxyJump,
    } = req.body;
    const resolvedUser = String(user ?? username ?? '').trim();
    const resolvedProxyJump = String(proxy_jump ?? proxyJump ?? '').trim();
    const sharedFs = resolveSharedFsConfig(req.body || {}, {
      enabled: false,
      peers: [],
      verifiedPeers: [],
      probePath: '~',
    });
    if (!name || !host || !resolvedUser) {
      return res.status(400).json({ error: 'name, host, and user are required' });
    }
    if (sharedFs.enabled && sharedFs.peers.length === 0) {
      return res.status(400).json({
        error: 'At least one peer server is required when shared filesystem mapping is enabled',
      });
    }
    const db = getDb();
    const result = await db.execute({
      sql: `
        INSERT INTO ssh_servers (
          name, host, user, port, ssh_key_path, proxy_jump,
          shared_fs_enabled, shared_fs_group, shared_fs_local_path, shared_fs_remote_path,
          shared_fs_peers, shared_fs_verified_peers,
          shared_fs_verified, shared_fs_last_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        name.trim(),
        host.trim(),
        resolvedUser,
        parseInt(port) || 22,
        (ssh_key_path || '~/.ssh/id_rsa').trim(),
        resolvedProxyJump,
        sharedFs.enabled ? 1 : 0,
        '',
        '',
        sharedFs.probePath || '~',
        JSON.stringify(sharedFs.peers),
        JSON.stringify([]),
        0,
        sharedFs.enabled ? 'Not verified (peer checks pending)' : 'Shared filesystem disabled',
      ],
    });
    const server = await db.execute({
      sql: `SELECT * FROM ssh_servers WHERE id = ?`,
      args: [result.lastInsertRowid],
    });
    res.status(201).json({ server: server.rows[0] });
  } catch (err) {
    console.error('Error creating SSH server:', err);
    res.status(500).json({ error: 'Failed to create SSH server' });
  }
});

// PUT /api/ssh-servers/:id - Update a server
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const existingResult = await db.execute({
      sql: `SELECT * FROM ssh_servers WHERE id = ?`,
      args: [req.params.id],
    });
    if (!existingResult.rows.length) return res.status(404).json({ error: 'Server not found' });
    const existing = existingResult.rows[0];

    const {
      name,
      host,
      user,
      username,
      port = 22,
      ssh_key_path = '~/.ssh/id_rsa',
      proxy_jump,
      proxyJump,
    } = req.body;
    const resolvedUser = String(user ?? username ?? '').trim();
    const resolvedProxyJump = String(proxy_jump ?? proxyJump ?? '').trim();
    const sharedFs = resolveSharedFsConfig(
      req.body || {},
      sharedFsFromServer(existing),
      { selfId: req.params.id }
    );
    if (!name || !host || !resolvedUser) {
      return res.status(400).json({ error: 'name, host, and user are required' });
    }
    if (sharedFs.enabled && sharedFs.peers.length === 0) {
      return res.status(400).json({
        error: 'At least one peer server is required when shared filesystem mapping is enabled',
      });
    }

    const previousSharedFs = sharedFsFromServer(existing);
    const sharedFsChanged = (
      previousSharedFs.enabled !== sharedFs.enabled
      || !sameStringArray(previousSharedFs.peers, sharedFs.peers)
    );
    const nextVerifiedPeers = sharedFs.enabled
      ? previousSharedFs.verifiedPeers.filter((peerId) => sharedFs.peers.includes(peerId))
      : [];
    const nextSharedFsVerified = nextVerifiedPeers.length > 0 ? 1 : 0;
    const nextSharedFsCheckedAt = sharedFsChanged ? null : (existing.shared_fs_last_checked_at || null);
    const nextSharedFsStatus = sharedFsChanged
      ? (sharedFs.enabled ? 'Peer list changed; verify shared filesystem with selected peers' : 'Shared filesystem disabled')
      : String(
        existing.shared_fs_last_status
        || (sharedFs.enabled ? 'Not verified (peer checks pending)' : 'Shared filesystem disabled')
      );

    await db.execute({
      sql: `
        UPDATE ssh_servers
        SET name = ?,
            host = ?,
            user = ?,
            port = ?,
            ssh_key_path = ?,
            proxy_jump = ?,
            shared_fs_enabled = ?,
            shared_fs_group = ?,
            shared_fs_local_path = ?,
            shared_fs_remote_path = ?,
            shared_fs_peers = ?,
            shared_fs_verified_peers = ?,
            shared_fs_verified = ?,
            shared_fs_last_checked_at = ?,
            shared_fs_last_status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      args: [
        name.trim(),
        host.trim(),
        resolvedUser,
        parseInt(port) || 22,
        (ssh_key_path || '~/.ssh/id_rsa').trim(),
        resolvedProxyJump,
        sharedFs.enabled ? 1 : 0,
        '',
        '',
        sharedFs.probePath || '~',
        JSON.stringify(sharedFs.peers),
        JSON.stringify(nextVerifiedPeers),
        nextSharedFsVerified,
        nextSharedFsCheckedAt,
        nextSharedFsStatus,
        req.params.id,
      ],
    });
    const server = await db.execute({
      sql: `SELECT * FROM ssh_servers WHERE id = ?`,
      args: [req.params.id],
    });
    if (!server.rows.length) return res.status(404).json({ error: 'Server not found' });
    res.json({ server: server.rows[0] });
  } catch (err) {
    console.error('Error updating SSH server:', err);
    res.status(500).json({ error: 'Failed to update SSH server' });
  }
});

// DELETE /api/ssh-servers/:id - Delete a server
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.execute({ sql: `DELETE FROM ssh_servers WHERE id = ?`, args: [req.params.id] });
    res.json({ success: true });
  } catch (err) {
    console.error('Error deleting SSH server:', err);
    res.status(500).json({ error: 'Failed to delete SSH server' });
  }
});

// ─── Utility endpoints ─────────────────────────────────────────────────────

// GET /api/ssh-servers/public-key — returns the system managed public key
router.get('/public-key', requireAuth, (req, res) => {
  const pubPath = keypairService.MANAGED_KEY_PUB_PATH;
  try {
    const publicKey = fs.readFileSync(pubPath, 'utf8').trim();
    res.json({ publicKey, path: pubPath });
  } catch {
    res.status(404).json({ error: 'Managed public key not found. Restart the server to generate it.' });
  }
});

// GET /api/ssh-servers/config-hosts?configPath=~/.ssh/config
// Parse an SSH config file path on backend server and return host entries.
router.get('/config-hosts', requireAuth, (req, res) => {
  const requestedPath = String(req.query.configPath || '~/.ssh/config').trim();
  if (!requestedPath) {
    return res.status(400).json({ error: 'configPath is required' });
  }

  const configPath = path.resolve(expandHome(requestedPath));
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    res.json({ hosts: parseSshConfig(content), path: configPath });
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return res.status(404).json({ error: `SSH config file not found: ${configPath}` });
    }
    if (err?.code === 'EISDIR') {
      return res.status(400).json({ error: `Path is a directory, not a file: ${configPath}` });
    }
    if (err?.code === 'EACCES' || err?.code === 'EPERM') {
      return res.status(403).json({ error: `Permission denied reading: ${configPath}` });
    }
    return res.status(400).json({ error: `Failed to read SSH config: ${err.message}` });
  }
});

// POST /api/ssh-servers/config-hosts/upload
// Parse an uploaded SSH config file from client device and return host entries.
router.post('/config-hosts/upload', requireAuth, (req, res) => {
  upload.single('configFile')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'SSH config file too large (max 512 KB)' });
      }
      return res.status(400).json({ error: err.message || 'Failed to upload SSH config file' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'configFile is required' });
    }

    try {
      const content = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
      const hosts = parseSshConfig(content);
      return res.json({
        hosts,
        filename: req.file.originalname || 'uploaded-config',
      });
    } catch (parseErr) {
      return res.status(400).json({ error: `Failed to parse uploaded SSH config: ${parseErr.message}` });
    }
  });
});

// POST /api/ssh-servers/:id/test — verify passwordless SSH connectivity
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [req.params.id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
    const s = result.rows[0];
    await runSshCommand(s, ['exit', '0'], { timeoutMs: 20000 });

    res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// POST /api/ssh-servers/:id/shared-fs/check — verify shared filesystem between servers
router.post('/:id/shared-fs/check', requireAuth, async (req, res) => {
  const db = getDb();
  let server = null;
  let peerServer = null;
  try {
    const result = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [req.params.id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
    server = result.rows[0];
    const peerServerId = String(
      req.body?.peerServerId
      ?? req.body?.peer_server_id
      ?? ''
    ).trim();
    if (!peerServerId) {
      return res.status(400).json({ error: 'peerServerId is required for server-to-server shared filesystem check' });
    }
    if (String(server.id) === peerServerId) {
      return res.status(400).json({ error: 'peerServerId must be different from server id' });
    }
    const peerResult = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [peerServerId] });
    if (!peerResult.rows.length) return res.status(404).json({ error: 'Peer server not found' });
    peerServer = peerResult.rows[0];

    const sourceSharedFs = sharedFsFromServer(server);
    const peerSharedFs = sharedFsFromServer(peerServer);
    if (!sourceSharedFs.enabled) {
      return res.status(400).json({
        error: 'Shared filesystem is disabled for this server. Enable it and configure peers first.',
      });
    }
    if (!peerSharedFs.enabled) {
      return res.status(400).json({
        error: 'Shared filesystem is disabled for peer server. Enable it and configure peers first.',
      });
    }
    if (!sourceSharedFs.peers.includes(peerServerId)) {
      return res.status(400).json({
        error: 'Peer server is not in this server\'s configured peer list. Add it first.',
      });
    }
    if (!peerSharedFs.peers.includes(String(server.id))) {
      return res.status(400).json({
        error: 'This server is not in peer server\'s configured peer list. Add it there first.',
      });
    }

    const details = await verifySharedFilesystemPair(
      server,
      peerServer,
      sourceSharedFs.probePath,
      peerSharedFs.probePath
    );
    const verifiedAt = new Date().toISOString();
    const sourceVerifiedPeers = normalizePeerIds([
      ...sourceSharedFs.verifiedPeers,
      peerServerId,
    ]).filter((id) => sourceSharedFs.peers.includes(id));
    const peerVerifiedPeers = normalizePeerIds([
      ...peerSharedFs.verifiedPeers,
      String(server.id),
    ]).filter((id) => peerSharedFs.peers.includes(id));
    const sourceStatus = `Verified peer ${peerServer.name} at ${verifiedAt}`;
    const peerStatus = `Verified peer ${server.name} at ${verifiedAt}`;
    await updateSharedFsCheckStatus(db, server.id, {
      verifiedPeers: sourceVerifiedPeers,
      status: sourceStatus,
    });
    await updateSharedFsCheckStatus(db, peerServer.id, {
      verifiedPeers: peerVerifiedPeers,
      status: peerStatus,
    });
    const updated = await db.execute({
      sql: `SELECT * FROM ssh_servers WHERE id IN (?, ?) ORDER BY name`,
      args: [server.id, peerServer.id],
    });

    return res.json({
      success: true,
      message: details.message,
      details,
      server: (updated.rows || []).find((item) => String(item.id) === String(server.id)) || server,
      peerServer: (updated.rows || []).find((item) => String(item.id) === String(peerServer.id)) || peerServer,
    });
  } catch (err) {
    const errorMessage = err?.message || 'Shared filesystem check failed';
    if (server?.id) {
      try {
        const sourceSharedFs = sharedFsFromServer(server);
        const targetId = String(peerServer?.id || '').trim();
        const nextVerifiedPeers = sourceSharedFs.verifiedPeers
          .filter((id) => id !== targetId && sourceSharedFs.peers.includes(id));
        await updateSharedFsCheckStatus(db, server.id, {
          verifiedPeers: nextVerifiedPeers,
          status: errorMessage,
        });
      } catch (persistErr) {
        console.warn('[SSH shared-fs] failed to persist check failure:', persistErr.message);
      }
    }
    if (peerServer?.id) {
      try {
        const peerSharedFs = sharedFsFromServer(peerServer);
        const sourceId = String(server?.id || '').trim();
        const nextVerifiedPeers = peerSharedFs.verifiedPeers
          .filter((id) => id !== sourceId && peerSharedFs.peers.includes(id));
        await updateSharedFsCheckStatus(db, peerServer.id, {
          verifiedPeers: nextVerifiedPeers,
          status: errorMessage,
        });
      } catch (persistErr) {
        console.warn('[SSH shared-fs] failed to persist peer check failure:', persistErr.message);
      }
    }
    return res.json({ success: false, message: errorMessage });
  }
});

// POST /api/ssh-servers/:id/authorize-key — push public key via sshpass + ssh-copy-id
router.post('/:id/authorize-key', requireAuth, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password is required' });

  try {
    const db = getDb();
    const result = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [req.params.id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
    const s = result.rows[0];
    const pubPath = keypairService.MANAGED_KEY_PUB_PATH;

    if (!fs.existsSync(pubPath)) {
      return res.status(400).json({ error: 'Managed public key not found. Restart the server to generate it.' });
    }

    // Check sshpass is available
    await new Promise((resolve, reject) => {
      const which = spawn('which', ['sshpass']);
      which.on('close', (code) => code === 0 ? resolve() : reject(new Error('sshpass_missing')));
    });

    // Use SSHPASS env var — never pass password as a CLI argument
    await new Promise((resolve, reject) => {
      const copyArgs = [
        '-e', // read password from SSHPASS env var
        'ssh-copy-id',
        '-i', pubPath,
        '-p', String(s.port || 22),
        '-o', 'StrictHostKeyChecking=accept-new',
      ];
      if (String(s.proxy_jump || '').trim()) {
        copyArgs.push('-o', `ProxyJump=${String(s.proxy_jump).trim()}`);
      }
      copyArgs.push(`${s.user}@${s.host}`);
      const proc = spawn('sshpass', copyArgs, { env: { ...process.env, SSHPASS: password } });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `exit code ${code}`));
      });
      proc.on('error', (err) => reject(new Error(err.message)));
    });

    res.json({ success: true, message: `Key authorized on ${s.host}` });
  } catch (err) {
    if (err.message === 'sshpass_missing') {
      return res.status(503).json({
        error: 'sshpass not installed on this server',
        hint: 'Install it with: apt install sshpass  (or: brew install hudochenkov/sshpass/sshpass)',
      });
    }
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
