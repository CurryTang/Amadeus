#!/usr/bin/env node
// session-monitor.js — Detect local Claude Code sessions from JSONL files
// Works with CLI, VS Code extension, SDK — any client that writes to ~/.claude/projects/

const fs = require('fs');
const path = require('path');
const os = require('os');

const claudeProjects = path.join(os.homedir(), '.claude', 'projects');
const sessions = [];
const now = Date.now();
const ACTIVE_THRESHOLD = 5 * 60 * 1000;   // 5 min = active
const RECENT_THRESHOLD = 24 * 3600 * 1000; // 24h = worth reporting

if (!fs.existsSync(claudeProjects)) {
  console.log(JSON.stringify([]));
  process.exit(0);
}

for (const dirName of fs.readdirSync(claudeProjects)) {
  const projDir = path.join(claudeProjects, dirName);
  let stat;
  try { stat = fs.statSync(projDir); } catch (_) { continue; }
  if (!stat.isDirectory()) continue;

  let jsonlFiles;
  try {
    jsonlFiles = fs.readdirSync(projDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        try {
          const s = fs.statSync(path.join(projDir, f));
          return { name: f, mtime: s.mtimeMs, size: s.size };
        } catch (_) { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) { continue; }

  for (const file of jsonlFiles) {
    const age = now - file.mtime;
    if (age > RECENT_THRESHOLD) continue;
    if (file.size < 50) continue;

    const isActive = age < ACTIVE_THRESHOLD;
    const filePath = path.join(projDir, file.name);

    // Convert dir name back to path: -Users-czk-auto-researcher -> /Users/czk/auto-researcher
    // Hyphens are ambiguous (could be path separators or literal hyphens).
    // Try progressively joining segments with hyphens until we find a real path.
    const segments = dirName.replace(/^-/, '').split('-');
    let cwd = '';
    let testPath = '/';
    for (let i = 0; i < segments.length; i++) {
      const tryJoin = testPath + (testPath.endsWith('/') ? '' : '-') + segments[i];
      const trySlash = testPath + (testPath.endsWith('/') ? '' : '/') + segments[i];
      if (fs.existsSync(trySlash)) {
        testPath = trySlash;
      } else if (fs.existsSync(tryJoin)) {
        testPath = tryJoin;
      } else {
        // Neither exists yet — prefer slash (standard path separator)
        testPath = trySlash;
      }
    }
    cwd = testPath;

    let sessionName = '';
    let model = '';
    let rawContext = '';
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.trim().split('\n');
      const contextParts = [];

      for (const l of lines) {
        try {
          const j = JSON.parse(l);

          if (!model && j.model) model = j.model;

          if (j.type === 'user' || j.type === 'assistant') {
            const c = j.message?.content || '';
            const text = typeof c === 'string' ? c : Array.isArray(c)
              ? c.filter(x => x.type === 'text').map(x => x.text).join(' ') : '';
            if (!text || text.length < 5) continue;
            if (text.startsWith('<ide_') || text.startsWith('<system')
              || text.startsWith('<task-') || text.startsWith('<command')
              || text.startsWith('Base directory') || text.startsWith('<local-command')
              || text.startsWith('[Request interrupted')
              || text.startsWith('This session is being continued')) continue;

            if (!sessionName && j.type === 'user') {
              sessionName = text.substring(0, 100).replace(/[\n\r]+/g, ' ').replace(/"/g, "'");
            }
            if (contextParts.join('').length < 500) {
              contextParts.push((j.type === 'user' ? 'User: ' : 'Asst: ') + text.substring(0, 200));
            }
          }
        } catch (_) { /* skip malformed line */ }
      }
      if (!sessionName && contextParts.length > 0) {
        rawContext = contextParts.join('\n').substring(0, 600).replace(/"/g, "'");
      }
    } catch (_) { /* skip unreadable file */ }

    sessions.push({
      pid: 0,
      cpu: 0,
      memMb: 0,
      elapsed: '',
      model: model || 'unknown',
      cwd,
      startedAt: '',
      isActive,
      lastActiveAt: new Date(file.mtime).toISOString(),
      sessionName: sessionName || file.name.replace('.jsonl', ''),
      sessionFile: file.name,
      ...(rawContext ? { rawContext } : {}),
    });
  }
}

// Sort: active first, then by lastActiveAt desc
sessions.sort((a, b) => {
  if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
  return new Date(b.lastActiveAt) - new Date(a.lastActiveAt);
});

console.log(JSON.stringify(sessions.slice(0, 20)));
