#!/bin/bash
# session-monitor.sh — Push local Claude Code session info to ARIS API
# Cron: runs every 30s automatically

ARIS_API="${ARIS_API:-https://auto-reader.duckdns.org/api}"
ARIS_TOKEN="${ARIS_TOKEN:-***REDACTED_ADMIN_TOKEN***}"

# Use node to collect sessions with prompt extraction
SESSIONS=$(node -e "
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Get running Claude processes
const psOut = execSync('/bin/ps -eo pid,pcpu,rss,lstart,etime,command', { encoding: 'utf8' });
const sessions = [];
const oneWeek = 7 * 24 * 3600 * 1000;
const now = Date.now();

for (const line of psOut.split('\n')) {
  if (!line.includes('--output-format') || line.includes('grep')) continue;

  const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(\w+ \w+ \d+ [\d:]+ \d+)\s+([\d\-:]+)\s+(.+)$/);
  if (!m) continue;

  const [, pid, cpu, rss, lstart, elapsed, cmd] = m;
  const modelMatch = cmd.match(/--model\s+(\S+)/);
  const model = modelMatch ? modelMatch[1] : 'default';
  const memMb = Math.round(parseInt(rss) / 1024);

  // Parse start time
  let startedAt = '';
  try {
    const d = new Date(lstart);
    if (!isNaN(d.getTime())) {
      if (now - d.getTime() > oneWeek) continue; // skip > 7 days
      startedAt = d.toISOString();
    }
  } catch(_) {}

  // Get CWD
  let cwd = 'unknown';
  try {
    const lsofOut = execSync('lsof -a -p ' + pid + ' -d cwd -Fn 2>/dev/null', { encoding: 'utf8' });
    const cwdMatch = lsofOut.match(/\nn(.+)/);
    if (cwdMatch) cwd = cwdMatch[1];
  } catch(_) {}

  const isActive = parseFloat(cpu) >= 1;

  // Extract session prompt from most recent conversation JSONL
  let sessionName = '';
  let matchedFileName = '';
  try {
    const claudeProjects = path.join(os.homedir(), '.claude/projects');
    // Convert cwd to claude project dir name: /Users/czk/foo -> -Users-czk-foo
    const dirName = cwd.replace(/\//g, '-');
    const projDir = path.join(claudeProjects, dirName);
    if (fs.existsSync(projDir)) {
      const jsonlFiles = fs.readdirSync(projDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(projDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      // Match PID to JSONL by finding the file whose mtime is closest to (and after) session start
      const startMs = startedAt ? new Date(startedAt).getTime() : 0;
      // Find files that were active around the session start time
      const usedFiles = sessions.map(s => s._matchedFile).filter(Boolean);
      let targetFile = null;
      if (startMs) {
        targetFile = jsonlFiles.find(f => Math.abs(f.mtime - startMs) < 24*3600*1000 && !usedFiles.includes(f.name))
          || jsonlFiles.find(f => !usedFiles.includes(f.name))
          || jsonlFiles[0];
      } else {
        targetFile = jsonlFiles.find(f => !usedFiles.includes(f.name)) || jsonlFiles[0];
      }
      if (targetFile) {
        matchedFileName = targetFile.name;
        const content = fs.readFileSync(path.join(projDir, targetFile.name), 'utf8');
        const lines = content.trim().split('\n');
        for (const l of lines) {
          try {
            const j = JSON.parse(l);
            if (j.type === 'user') {
              const c = j.message?.content || '';
              const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x=>x.type==='text').map(x=>x.text).join(' ') : '';
              if (text && text.length > 5 && !text.startsWith('<ide_') && !text.startsWith('<system') && !text.startsWith('<task-') && !text.startsWith('<command') && !text.startsWith('Base directory') && !text.startsWith('<local-command')) {
                sessionName = text.substring(0, 100).replace(/[\\n\\r]+/g, ' ').replace(/\"/g, '');
                break;
              }
            }
          } catch(_) {}
        }
      }
    }
  } catch(_) {}

  const entry = { pid: parseInt(pid), cpu: parseFloat(cpu), memMb, elapsed, model, cwd, startedAt, isActive, sessionName };
  if (matchedFileName) entry._matchedFile = matchedFileName;
  sessions.push(entry);
}

console.log(JSON.stringify(sessions));
" 2>/dev/null)

# Push to ARIS API
/usr/bin/curl -s -X POST "${ARIS_API}/aris/local-sessions" \
  -H "Authorization: Bearer ${ARIS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":${SESSIONS:-[]}}" >/dev/null 2>&1
