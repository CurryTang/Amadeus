/**
 * horizon.watch — Fire-and-forget long-horizon watchdog module.
 *
 * Generates a bash watchdog script that:
 *   1. Optionally starts a main experiment command in the background.
 *   2. Sleeps for `intervalSecs` between checks (default 2h).
 *   3. Runs a user-supplied status-check command on each wakeup.
 *   4. Writes a JSON status file to ~/.researchops/horizon/<runId>.json
 *   5. Terminates when the check output matches a "done" pattern or max duration is exceeded.
 *
 * The watchdog runs inside a detached tmux session on the target server,
 * so this module returns immediately after launch (fire-and-forget).
 */

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const BaseModule = require('./base-module');
const { getDb } = require('../../../db');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function isLocalTarget(ref = '') {
  const v = cleanString(ref).toLowerCase();
  return !v || ['local', 'local-default', 'self', 'current'].includes(v);
}

async function getServerByRef(ref = '') {
  const normalized = cleanString(ref);
  if (!normalized || isLocalTarget(normalized)) return null;
  const db = getDb();
  let r = await db.execute({ sql: 'SELECT * FROM ssh_servers WHERE id = ?', args: [normalized] });
  if (r.rows?.length) return r.rows[0];
  r = await db.execute({ sql: 'SELECT * FROM ssh_servers WHERE name = ?', args: [normalized] });
  return r.rows?.[0] || null;
}

function buildSshArgs(server, { connectTimeout = 15 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-p', String(server?.port || 22),
  ];
  if (cleanString(server?.proxy_jump)) args.push('-J', cleanString(server.proxy_jump));
  return args;
}

function buildScpArgs(server, { connectTimeout = 15 } = {}) {
  const keyPath = expandHome(server?.ssh_key_path || '~/.ssh/id_rsa');
  const args = [
    '-F', '/dev/null',
    '-o', 'BatchMode=yes',
    '-o', 'ClearAllForwardings=yes',
    '-o', `ConnectTimeout=${connectTimeout}`,
    '-o', 'StrictHostKeyChecking=accept-new',
    '-i', keyPath,
    '-P', String(server?.port || 22),
  ];
  if (cleanString(server?.proxy_jump)) args.push('-J', cleanString(server.proxy_jump));
  return args;
}

async function runProcess(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, opts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c) => { stdout += c.toString(); });
    child.stderr?.on('data', (c) => { stderr += c.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) { resolve({ stdout, stderr }); return; }
      const err = new Error(`${cmd} exited with code ${code}`);
      err.code = code;
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
  });
}

/** Build the watchdog bash script. Commands are base64-embedded to avoid quoting issues. */
function buildWatchdogScript({ runId, mainCmd, checkCmd, intervalSecs, maxSecs }) {
  const mainB64 = Buffer.from(mainCmd || '').toString('base64');
  const checkB64 = Buffer.from(checkCmd || 'echo running').toString('base64');
  const sessionTag = `hz_${runId.slice(0, 10)}`;

  // portable ISO date (works on GNU and BSD date)
  return `#!/usr/bin/env bash
set -uo pipefail

RUNID='${runId}'
HORIZON_DIR="$HOME/.researchops/horizon"
LOG="$HORIZON_DIR/${runId}.log"
STATUS="$HORIZON_DIR/${runId}.json"
INTERVAL=${intervalSecs}
MAX_SECS=${maxSecs}
MAIN_CMD=$(echo '${mainB64}' | base64 -d 2>/dev/null || echo '')
CHECK_CMD=$(echo '${checkB64}' | base64 -d 2>/dev/null || echo 'echo running')
START_TS=$(date +%s)
WAKEUPS=0

mkdir -p "$HORIZON_DIR"

_log() {
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%s)
  printf '[%s] %s\\n' "$ts" "$*" | tee -a "$LOG"
}

_iso() {
  # portable ISO-8601 for a unix timestamp
  local ts="$1"
  date -d "@$ts" -Iseconds 2>/dev/null || date -r "$ts" -Iseconds 2>/dev/null || echo "$ts"
}

_jstr() {
  # minimal JSON string escape
  python3 -c "import sys,json;print(json.dumps(sys.stdin.read()))" 2>/dev/null <<< "$1" \
    || printf '"%s"' "$(echo "$1" | sed 's/"/\\\\"/g')"
}

_write_status() {
  local status="$1" msg="$2" next="${3:-}"
  local now_iso
  now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date +%s)
  printf '{"status":"%s","message":%s,"lastCheck":"%s","nextCheck":"%s","wakeups":%d,"runId":"%s"}\\n' \
    "$status" "$(_jstr "$msg")" "$now_iso" "$next" "$WAKEUPS" "$RUNID" > "$STATUS"
}

_log "=== Horizon watchdog starting ==="
_log "runId=$RUNID session=${sessionTag}"
_log "interval=${INTERVAL}s max=${MAX_SECS}s"
_write_status "starting" "Watchdog launched" ""

# ── Start main experiment command (background, if provided) ─────────────────
if [ -n "$MAIN_CMD" ]; then
  _log "Starting main command..."
  eval "$MAIN_CMD" >> "$HORIZON_DIR/${runId}.main.log" 2>&1 &
  MAIN_PID=$!
  _log "Main command started (pid=$MAIN_PID)"
  _write_status "running" "Main command running (pid=$MAIN_PID)" ""
else
  _log "No main command — watchdog-only mode"
  _write_status "running" "Watchdog running (no main cmd)" ""
fi

# ── Main watch loop ──────────────────────────────────────────────────────────
while true; do
  NOW=$(date +%s)
  ELAPSED=$(( NOW - START_TS ))

  if [ "$ELAPSED" -ge "$MAX_SECS" ]; then
    _log "=== MAX DURATION REACHED (${ELAPSED}s >= ${MAX_SECS}s) ==="
    _write_status "timeout" "Exceeded max duration ${MAX_SECS}s" ""
    break
  fi

  NEXT_TS=$(( NOW + INTERVAL ))
  NEXT_ISO=$(_iso "$NEXT_TS")

  WAKEUPS=$(( WAKEUPS + 1 ))
  _log "=== Wakeup #$WAKEUPS | elapsed=${ELAPSED}s | next=$NEXT_ISO ==="

  CHECK_OUT=$(eval "$CHECK_CMD" 2>&1) || CHECK_OUT="(check command failed with exit $?)"
  _log "Check: $CHECK_OUT"

  # Detect terminal states
  if echo "$CHECK_OUT" | grep -qiE "(^|[[:space:]])(done|finished|complete|completed|success|converged|stopped|terminated|exited)([[:space:]]|[[:punct:]]|$)"; then
    _log "=== Detected completion ==="
    _write_status "done" "$CHECK_OUT" ""
    break
  fi

  _write_status "running" "$CHECK_OUT" "$NEXT_ISO"
  _log "Sleeping ${INTERVAL}s (next check: $NEXT_ISO)..."
  sleep "$INTERVAL"
done

_log "=== Horizon watchdog exiting ==="
`;
}

/** Derive a short tmux session name from the run ID */
function sessionName(runId) {
  return `hz_${cleanString(runId).slice(0, 10)}`;
}

class HorizonWatchModule extends BaseModule {
  constructor() {
    super('horizon.watch');
  }

  validate(step) {
    super.validate(step);
  }

  async run(step, context) {
    const inputs = step.inputs && typeof step.inputs === 'object' ? step.inputs : {};
    const run = context.run || {};
    const runId = cleanString(run.id);
    if (!runId) throw new Error('horizon.watch: run.id is required');

    const mainCmd = cleanString(inputs.mainCmd || '');
    const checkCmd = cleanString(inputs.checkCmd || 'echo running');
    const intervalSecs = Math.max(1800, Number(inputs.intervalSecs) || 7200);   // min 30 min
    const maxSecs = Math.max(3600, Number(inputs.maxSecs) || 259200);            // min 1h, default 72h

    const execServerRef = cleanString(
      inputs.execServerId || inputs.sshServerId || run?.serverId || ''
    );
    const execServer = await getServerByRef(execServerRef);

    const script = buildWatchdogScript({ runId, mainCmd, checkCmd, intervalSecs, maxSecs });
    const session = sessionName(runId);

    await context.emitStepLog(step, `[horizon] Launching watchdog (session=${session}, interval=${intervalSecs}s, max=${maxSecs}s)`);

    if (execServer) {
      // ── Remote: SCP script then start in detached tmux ──────────────────
      const sshTarget = `${execServer.user}@${execServer.host}`;

      // Write script to local tmp
      const tmpScript = path.join(os.tmpdir(), `horizon_${runId}.sh`);
      await fs.writeFile(tmpScript, script, { mode: 0o755 });

      // SCP to remote
      const remotePath = `/tmp/horizon_${runId}.sh`;
      await runProcess('scp', [
        ...buildScpArgs(execServer),
        tmpScript,
        `${sshTarget}:${remotePath}`,
      ]);

      // Start in detached tmux on remote
      const startCmd = `chmod +x ${remotePath} && tmux new-session -d -s '${session}' "bash ${remotePath}" 2>/dev/null || tmux new-session -d -s '${session}_${Date.now()}' "bash ${remotePath}"`;
      await runProcess('ssh', [
        ...buildSshArgs(execServer),
        sshTarget,
        startCmd,
      ]);

      await context.emitStepLog(step, `[horizon] Started on ${sshTarget} in tmux session '${session}'`);

      // Clean up local tmp
      fs.unlink(tmpScript).catch(() => {});
    } else {
      // ── Local: write script and start detached bash process ─────────────
      const localDir = path.join(os.homedir(), '.researchops', 'horizon');
      await fs.mkdir(localDir, { recursive: true });
      const localScript = path.join(localDir, `${runId}.sh`);
      await fs.writeFile(localScript, script, { mode: 0o755 });

      // Try tmux first, fall back to nohup
      let started = false;
      try {
        await runProcess('tmux', ['new-session', '-d', '-s', session, `bash ${localScript}`]);
        started = true;
      } catch (_) {
        // tmux not available
      }

      if (!started) {
        // nohup fallback
        const logPath = path.join(localDir, `${runId}.log`);
        const child = spawn('bash', [localScript], {
          detached: true,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
        child.unref();
        await context.emitStepLog(step, `[horizon] Started locally (nohup). Log: ${logPath}`);
      } else {
        await context.emitStepLog(step, `[horizon] Started locally in tmux session '${session}'`);
      }
    }

    const statusFile = `~/.researchops/horizon/${runId}.json`;
    const logFile = `~/.researchops/horizon/${runId}.log`;
    await context.emitStepLog(step, `[horizon] Status file: ${statusFile}`);
    await context.emitStepLog(step, `[horizon] Log file:    ${logFile}`);
    await context.emitStepLog(step, '[horizon] Watchdog is now running independently. This step is complete.');

    return {
      horizonSessionName: session,
      horizonStatusFile: statusFile,
      horizonLogFile: logFile,
      horizonServerId: execServer?.id || 'local-default',
      horizonIntervalSecs: intervalSecs,
      horizonMaxSecs: maxSecs,
      horizonStartedAt: new Date().toISOString(),
    };
  }
}

module.exports = HorizonWatchModule;
