const express = require('express');
const router = express.Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { requireAuth } = require('../middleware/auth');
const { getDb } = require('../db');

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
      current = { alias: value, host: value, user: '', port: 22, identityFile: '~/.ssh/id_rsa' };
    } else if (current) {
      if (key === 'hostname') current.host = value;
      else if (key === 'user') current.user = value;
      else if (key === 'port') current.port = parseInt(value) || 22;
      else if (key === 'identityfile') current.identityFile = value;
    }
  }
  if (current && current.alias !== '*') hosts.push(current);
  return hosts;
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
    const { name, host, user, port = 22, ssh_key_path = '~/.ssh/id_rsa' } = req.body;
    if (!name || !host || !user) {
      return res.status(400).json({ error: 'name, host, and user are required' });
    }
    const db = getDb();
    const result = await db.execute({
      sql: `INSERT INTO ssh_servers (name, host, user, port, ssh_key_path) VALUES (?, ?, ?, ?, ?)`,
      args: [name.trim(), host.trim(), user.trim(), parseInt(port) || 22, (ssh_key_path || '~/.ssh/id_rsa').trim()],
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
    const { name, host, user, port = 22, ssh_key_path = '~/.ssh/id_rsa' } = req.body;
    if (!name || !host || !user) {
      return res.status(400).json({ error: 'name, host, and user are required' });
    }
    const db = getDb();
    await db.execute({
      sql: `UPDATE ssh_servers SET name = ?, host = ?, user = ?, port = ?, ssh_key_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      args: [name.trim(), host.trim(), user.trim(), parseInt(port) || 22, (ssh_key_path || '~/.ssh/id_rsa').trim(), req.params.id],
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

// GET /api/ssh-servers/public-key?keyPath=~/.ssh/id_rsa
router.get('/public-key', requireAuth, (req, res) => {
  const keyPath = expandHome(req.query.keyPath || '~/.ssh/id_rsa');
  const pubPath = keyPath.endsWith('.pub') ? keyPath : `${keyPath}.pub`;
  try {
    const publicKey = fs.readFileSync(pubPath, 'utf8').trim();
    res.json({ publicKey, path: pubPath });
  } catch {
    res.status(404).json({ error: `Public key not found at ${pubPath}` });
  }
});

// GET /api/ssh-servers/config-hosts — parse ~/.ssh/config and return host entries
router.get('/config-hosts', requireAuth, (req, res) => {
  const configPath = path.join(os.homedir(), '.ssh', 'config');
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    res.json({ hosts: parseSshConfig(content) });
  } catch {
    // File doesn't exist or unreadable — not an error
    res.json({ hosts: [] });
  }
});

// POST /api/ssh-servers/:id/test — verify passwordless SSH connectivity
router.post('/:id/test', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.execute({ sql: `SELECT * FROM ssh_servers WHERE id = ?`, args: [req.params.id] });
    if (!result.rows.length) return res.status(404).json({ error: 'Server not found' });
    const s = result.rows[0];
    const keyPath = expandHome(s.ssh_key_path || '~/.ssh/id_rsa');

    await new Promise((resolve, reject) => {
      const proc = spawn('ssh', [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-i', keyPath,
        '-p', String(s.port || 22),
        `${s.user}@${s.host}`,
        'exit', '0',
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `exit code ${code}`));
      });
      proc.on('error', (err) => reject(new Error(err.message)));
    });

    res.json({ success: true, message: 'Connection successful' });
  } catch (err) {
    res.json({ success: false, message: err.message });
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
    const keyPath = expandHome(s.ssh_key_path || '~/.ssh/id_rsa');
    const pubPath = keyPath.endsWith('.pub') ? keyPath : `${keyPath}.pub`;

    if (!fs.existsSync(pubPath)) {
      return res.status(400).json({ error: `Public key not found at ${pubPath}. Run: ssh-keygen` });
    }

    // Check sshpass is available
    await new Promise((resolve, reject) => {
      const which = spawn('which', ['sshpass']);
      which.on('close', (code) => code === 0 ? resolve() : reject(new Error('sshpass_missing')));
    });

    // Use SSHPASS env var — never pass password as a CLI argument
    await new Promise((resolve, reject) => {
      const proc = spawn('sshpass', [
        '-e', // read password from SSHPASS env var
        'ssh-copy-id',
        '-i', pubPath,
        '-p', String(s.port || 22),
        '-o', 'StrictHostKeyChecking=accept-new',
        `${s.user}@${s.host}`,
      ], { env: { ...process.env, SSHPASS: password } });

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
