'use strict';

const fs = require('fs/promises');
const { createObserverStore } = require('./observer-store');
const { runObserverIndexTick } = require('./indexer');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseArgs(argv = []) {
  const args = Array.isArray(argv) ? argv : [];
  const command = cleanString(args[0]).toLowerCase();
  const flags = {};
  for (let i = 1; i < args.length; i += 1) {
    const token = cleanString(args[i]);
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = cleanString(args[i + 1]);
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }
    flags[key] = next;
    i += 1;
  }
  return { command, flags };
}

async function readTailLines(filePath, limit = 120) {
  const text = await fs.readFile(filePath, 'utf8');
  const lines = String(text || '').split('\n').filter(Boolean);
  return lines.slice(-Math.max(Number(limit) || 120, 1)).join('\n');
}

async function runObserverCli(argv = []) {
  const { command, flags } = parseArgs(argv);
  const dbPath = cleanString(flags['db-path']);
  const store = await createObserverStore({ dbPath });

  try {
    if (flags.sync || command === 'sync') {
      await runObserverIndexTick({ store, state: null });
      if (command === 'sync') {
        return { ok: true };
      }
    }

    if (command === 'list') {
      const gitRoot = cleanString(flags['git-root']);
      if (!gitRoot) throw new Error('--git-root is required');
      return {
        items: await store.listSessionsByGitRoot(gitRoot),
      };
    }

    if (command === 'get') {
      const sessionId = cleanString(flags['session-id']);
      if (!sessionId) throw new Error('--session-id is required');
      return {
        item: await store.getSessionById(sessionId),
      };
    }

    if (command === 'excerpt') {
      const sessionId = cleanString(flags['session-id']);
      if (!sessionId) throw new Error('--session-id is required');
      const item = await store.getSessionById(sessionId);
      if (!item) {
        return { sessionId, excerpt: '' };
      }
      return {
        sessionId,
        excerpt: await readTailLines(item.sessionFile, Number(flags.limit) || 120),
      };
    }

    throw new Error(`Unsupported command: ${command || '<empty>'}`);
  } finally {
    await store.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const result = await runObserverCli(argv);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = {
  main,
  parseArgs,
  runObserverCli,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exit(1);
  });
}
