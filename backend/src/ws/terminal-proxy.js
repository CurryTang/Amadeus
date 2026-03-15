const { spawn } = require('child_process');
const url = require('url');
const cookie = require('cookie');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');
const config = require('../config');
const { getDb } = require('../db');
const sshTransport = require('../services/ssh-transport.service');
const sessionMirrorService = require('../services/session-mirror.service');

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    require('crypto').timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return require('crypto').timingSafeEqual(bufA, bufB);
}

function authenticateUpgrade(req) {
  // If auth is disabled, allow all
  if (!config.auth.enabled) return 'czk';

  // Try ?token= query param
  const parsed = url.parse(req.url, true);
  const tokenParam = parsed.query?.token;
  if (tokenParam) {
    // Try JWT first
    try {
      const payload = jwt.verify(tokenParam, config.auth.jwtSecret);
      return payload.username;
    } catch { /* fall through */ }

    // Try legacy ADMIN_TOKEN
    const expectedToken = config.auth.adminToken;
    if (expectedToken && timingSafeEqual(tokenParam, expectedToken)) {
      return 'czk';
    }
  }

  // Try cookie
  const cookies = cookie.parse(req.headers.cookie || '');
  const cookieToken = cookies.auth_token;
  if (cookieToken) {
    try {
      const payload = jwt.verify(cookieToken, config.auth.jwtSecret);
      return payload.username;
    } catch { /* fall through */ }
  }

  return null;
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname || '';

    // Only handle /api/ws/terminal/:sessionId
    const match = pathname.match(/^\/api\/ws\/terminal\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const userId = authenticateUpgrade(req);
    if (!userId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const sessionId = match[1];

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { sessionId, userId });
    });
  });

  wss.on('connection', async (ws, req, { sessionId, userId }) => {
    let sshChild = null;

    try {
      // Look up session — try DB first, then treat sessionId as a tmux session name
      let session = null;
      let server = null;

      const db = getDb();
      const result = await db.execute({
        sql: 'SELECT * FROM agent_sessions WHERE id = ?',
        args: [sessionId],
      });
      session = result.rows[0];

      if (session) {
        server = await sessionMirrorService.getServer(session.ssh_server_id);
      } else {
        // Maybe it's a discovered (untracked) session — need serverId from query
        const parsed = url.parse(req.url, true);
        const serverId = parsed.query?.serverId;
        if (serverId) {
          server = await sessionMirrorService.getServer(Number(serverId));
          if (server) {
            // Strip ext- prefix to get the real tmux session name
            const tmuxName = sessionId.replace(/^ext-/, '');
            session = { tmux_session_name: tmuxName, ssh_server_id: serverId };
          }
        }
      }

      if (!session || !server) {
        ws.close(4004, 'Session or server not found');
        return;
      }

      const tmuxName = session.tmux_session_name;

      // Mark as attached
      if (session.id) {
        sessionMirrorService.markAttached(session.id).catch(() => {});
      }

      // Build SSH args for PTY connection
      const keyPaths = sshTransport.resolveTargetKeyPaths(server);
      const targetKeyPath = keyPaths[0] || '';
      const sshArgs = [
        ...sshTransport.buildSshArgs(server, { targetKeyPath }),
        '-t', '-t', // Force PTY allocation
        sshTransport.getSshTarget(server),
        `tmux attach-session -t ${tmuxName}`,
      ];

      // Spawn SSH with PTY
      sshChild = spawn('ssh', sshArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'xterm-256color' },
      });

      // SSH stdout → WebSocket
      sshChild.stdout.on('data', (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });

      sshChild.stderr.on('data', (data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
        }
      });

      sshChild.on('close', (code) => {
        if (ws.readyState === ws.OPEN) {
          ws.close(1000, `SSH exited with code ${code}`);
        }
      });

      sshChild.on('error', (err) => {
        console.error('[terminal-proxy] SSH spawn error:', err.message);
        if (ws.readyState === ws.OPEN) {
          ws.close(1011, 'SSH connection failed');
        }
      });

      // WebSocket messages → SSH stdin
      ws.on('message', (message) => {
        if (!sshChild || sshChild.killed) return;

        // Check if it's a control message (JSON)
        if (typeof message === 'string' || (Buffer.isBuffer(message) && message[0] === 0x7b)) {
          try {
            const str = message.toString();
            const ctrl = JSON.parse(str);
            if (ctrl.type === 'resize' && ctrl.cols && ctrl.rows) {
              // Resize the tmux window
              const resizeCmd = `stty cols ${ctrl.cols} rows ${ctrl.rows}\n`;
              sshChild.stdin.write(resizeCmd);
              return;
            }
          } catch {
            // Not JSON — treat as regular terminal data
          }
        }

        sshChild.stdin.write(message);
      });

      ws.on('close', () => {
        if (sshChild && !sshChild.killed) {
          sshChild.kill('SIGTERM');
        }
      });

      ws.on('error', () => {
        if (sshChild && !sshChild.killed) {
          sshChild.kill('SIGTERM');
        }
      });

    } catch (err) {
      console.error('[terminal-proxy] connection error:', err.message);
      if (ws.readyState === ws.OPEN) {
        ws.close(1011, 'Internal error');
      }
      if (sshChild && !sshChild.killed) {
        sshChild.kill('SIGTERM');
      }
    }
  });

  console.log('[terminal-proxy] WebSocket server attached');
  return wss;
}

module.exports = { attachWebSocketServer };
