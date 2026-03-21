#!/bin/bash
# session-monitor.sh — Push local Claude Code session info to ARIS API
# Cron: runs every 30s automatically

ARIS_API="${ARIS_API:-https://auto-reader.duckdns.org/api}"
ARIS_TOKEN="${ARIS_TOKEN:?Set ARIS_TOKEN env var}"

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
  let rawContext = '';
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
        const contextParts = []; // collect conversation context for AI summary fallback
        for (const l of lines) {
          try {
            const j = JSON.parse(l);
            if (j.type === 'user' || j.type === 'assistant') {
              const c = j.message?.content || '';
              const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x=>x.type==='text').map(x=>x.text).join(' ') : '';
              if (!text || text.length < 5) continue;
              // Skip system/meta messages
              if (text.startsWith('<ide_') || text.startsWith('<system') || text.startsWith('<task-')
                || text.startsWith('<command') || text.startsWith('Base directory') || text.startsWith('<local-command')
                || text.startsWith('[Request interrupted') || text.startsWith('This session is being continued')) continue;
              // First good user message becomes sessionName
              if (!sessionName && j.type === 'user') {
                sessionName = text.substring(0, 100).replace(/[\\n\\r]+/g, ' ').replace(/\"/g, '');
              }
              // Collect context for AI summarization (first ~500 chars total)
              if (contextParts.join('').length < 500) {
                contextParts.push((j.type === 'user' ? 'User: ' : 'Assistant: ') + text.substring(0, 200));
              }
            }
          } catch(_) {}
        }
        // If no sessionName found, attach rawContext for backend AI summarization
        if (!sessionName && contextParts.length > 0) {
          rawContext = contextParts.join('\\n').substring(0, 600).replace(/\"/g, '');
        }
      }
    }
  } catch(_) {}

  const entry = { pid: parseInt(pid), cpu: parseFloat(cpu), memMb, elapsed, model, cwd, startedAt, isActive, sessionName };
  if (matchedFileName) entry._matchedFile = matchedFileName;
  if (rawContext) entry.rawContext = rawContext;
  sessions.push(entry);
}

console.log(JSON.stringify(sessions));
" 2>/dev/null)

# Push to ARIS API
/usr/bin/curl -s -X POST "${ARIS_API}/aris/local-sessions" \
  -H "Authorization: Bearer ${ARIS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"sessions\":${SESSIONS:-[]}}" >/dev/null 2>&1
