const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { getResearchOpsPaths } = require('./tree-plan.service');
const { runSshCommand, classifySshError } = require('../ssh-auth.service');

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function runCommand(command, args = [], { cwd = process.cwd(), timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Command timeout after ${timeoutMs}ms`));
      if (code === 0) return resolve({ stdout, stderr });
      return reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function resolveLocalCommit(projectPath, requestedCommit = '') {
  const commit = cleanString(requestedCommit);
  const cwd = path.resolve(expandHome(projectPath));
  if (commit) return commit;
  try {
    const { stdout } = await runCommand('git', ['-C', cwd, 'rev-parse', 'HEAD'], { timeoutMs: 12000 });
    return cleanString(String(stdout || '').split(/\r?\n/)[0]) || 'HEAD';
  } catch (_) {
    return 'HEAD';
  }
}

async function resolveRemoteCommit(server, projectPath, requestedCommit = '') {
  const commit = cleanString(requestedCommit);
  if (commit) return commit;
  const script = [
    'set -eu',
    'ROOT="$1"',
    'if [ ! -d "$ROOT" ]; then',
    '  echo "HEAD"',
    '  exit 0',
    'fi',
    'git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "HEAD"',
  ].join('\n');
  try {
    const { stdout } = await runSshCommand(server, ['bash', '-s', '--', projectPath], {
      timeoutMs: 20000,
      input: `${script}\n`,
    });
    return cleanString(String(stdout || '').split(/\r?\n/)[0]) || 'HEAD';
  } catch (_) {
    return 'HEAD';
  }
}

function deriveCapabilities(files = []) {
  const hasPyTrain = files.some((file) => /train|trainer/i.test(file) && file.endsWith('.py'));
  const hasEval = files.some((file) => /eval|evaluate/i.test(file));
  const hasConfigs = files.some((file) => /config|yaml|toml|json/i.test(file));
  const hasTests = files.some((file) => /test/i.test(file));

  return {
    tasks: [
      {
        name: 'run_smoke_test',
        enabled: hasTests,
        hint: hasTests ? 'pytest -q' : 'tests not detected',
      },
      {
        name: 'train_experiment',
        enabled: hasPyTrain,
        hint: hasPyTrain ? 'bash scripts/run_*.sh' : 'training entrypoint not detected',
      },
      {
        name: 'evaluate_model',
        enabled: hasEval,
        hint: hasEval ? 'python eval.py ...' : 'evaluation entrypoint not detected',
      },
      {
        name: 'tune_config',
        enabled: hasConfigs,
        hint: hasConfigs ? 'edit configs/*.yaml and rerun' : 'config schema not detected',
      },
    ],
  };
}

function buildInterfaceCards(files = []) {
  return files
    .filter((file) => /src\/|scripts\/|config|train|eval|model|runner/i.test(file))
    .slice(0, 64)
    .map((file) => ({
      id: file.replace(/[^a-zA-Z0-9_./-]/g, '_'),
      path: file,
      title: path.basename(file),
      summary: `Interface card for ${file}`,
      inputs: [],
      outputs: [],
      pitfalls: [],
    }));
}

async function listLocalFiles(projectPath) {
  const cwd = path.resolve(expandHome(projectPath));
  try {
    const { stdout } = await runCommand('git', ['-C', cwd, 'ls-files'], { timeoutMs: 20000 });
    const files = String(stdout || '')
      .split(/\r?\n/)
      .map((item) => cleanString(item))
      .filter(Boolean);
    return files.slice(0, 20000);
  } catch (_) {
    const { stdout } = await runCommand('find', [cwd, '-type', 'f'], { timeoutMs: 25000 });
    return String(stdout || '')
      .split(/\r?\n/)
      .map((item) => cleanString(item))
      .filter(Boolean)
      .map((absolute) => path.relative(cwd, absolute).replace(/\\/g, '/'))
      .slice(0, 20000);
  }
}

async function listRemoteFiles(server, projectPath) {
  const script = [
    'set -eu',
    'ROOT="$1"',
    'if [ ! -d "$ROOT" ]; then',
    '  echo "__NOT_DIR__"',
    '  exit 0',
    'fi',
    'if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  git -C "$ROOT" ls-files 2>/dev/null || true',
    'else',
    '  find "$ROOT" -type f 2>/dev/null | while IFS= read -r f; do printf "%s\\n" "${f#$ROOT/}"; done',
    'fi',
  ].join('\n');

  try {
    const { stdout } = await runSshCommand(server, ['bash', '-s', '--', projectPath], {
      timeoutMs: 40000,
      input: `${script}\n`,
    });
    const output = String(stdout || '');
    if (output.includes('__NOT_DIR__')) return [];
    return output
      .split(/\r?\n/)
      .map((item) => cleanString(item))
      .filter(Boolean)
      .slice(0, 20000);
  } catch (error) {
    const mapped = classifySshError(error);
    const wrapped = new Error(mapped.message);
    wrapped.code = mapped.code;
    throw wrapped;
  }
}

async function writeLocalRepoMapArtifacts(baseDir, payload) {
  await fs.mkdir(baseDir, { recursive: true });
  await fs.mkdir(path.join(baseDir, 'interface_cards'), { recursive: true });

  await fs.writeFile(path.join(baseDir, 'repo_map.json'), `${JSON.stringify(payload.repo_map, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(baseDir, 'configs_schema.json'), `${JSON.stringify(payload.configs_schema, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(baseDir, 'capabilities.yaml'), payload.capabilities_yaml, 'utf8');

  const cardWrites = payload.interface_cards.map((card) => {
    const fileName = card.id.replace(/\/+|\\+/g, '_').replace(/\./g, '_');
    const lines = [
      `# ${card.title}`,
      '',
      `- path: ${card.path}`,
      `- summary: ${card.summary}`,
      '',
      '## Inputs',
      '',
      '- (auto-generated placeholder)',
      '',
      '## Outputs',
      '',
      '- (auto-generated placeholder)',
      '',
      '## Pitfalls',
      '',
      '- (auto-generated placeholder)',
      '',
    ];
    return fs.writeFile(path.join(baseDir, 'interface_cards', `${fileName}.md`), lines.join('\n'), 'utf8');
  });
  await Promise.all(cardWrites);
}

function toYaml(obj = {}) {
  const lines = [];
  Object.entries(obj).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      value.forEach((item) => {
        if (item && typeof item === 'object') {
          lines.push('  -');
          Object.entries(item).forEach(([subKey, subValue]) => {
            lines.push(`      ${subKey}: ${JSON.stringify(subValue)}`);
          });
        } else {
          lines.push(`  - ${JSON.stringify(item)}`);
        }
      });
      return;
    }
    if (value && typeof value === 'object') {
      lines.push(`${key}:`);
      Object.entries(value).forEach(([subKey, subValue]) => {
        lines.push(`  ${subKey}: ${JSON.stringify(subValue)}`);
      });
      return;
    }
    lines.push(`${key}: ${JSON.stringify(value)}`);
  });
  return `${lines.join('\n')}\n`;
}

async function buildRepoMap({ project, server = null, commit = '', force = false } = {}) {
  const projectPath = cleanString(project?.projectPath);
  if (!projectPath) {
    const error = new Error('Project path is missing');
    error.code = 'PROJECT_PATH_MISSING';
    throw error;
  }

  const resolvedCommit = project.locationType === 'ssh'
    ? await resolveRemoteCommit(server, projectPath, commit)
    : await resolveLocalCommit(projectPath, commit);

  const paths = getResearchOpsPaths(projectPath);
  const cacheRoot = `${paths.cachePath}/${resolvedCommit}`;
  const localCacheRoot = path.resolve(expandHome(cacheRoot));

  if (!force) {
    try {
      const existing = await fs.readFile(path.join(localCacheRoot, 'repo_map.json'), 'utf8');
      if (existing) {
        const parsed = JSON.parse(existing);
        return {
          commit: resolvedCommit,
          cacheRoot,
          repo_map: parsed,
          cached: true,
        };
      }
    } catch (_) {
      // rebuild
    }
  }

  const files = project.locationType === 'ssh'
    ? await listRemoteFiles(server, projectPath)
    : await listLocalFiles(projectPath);

  const repoMap = {
    project_id: cleanString(project.id),
    project_path: projectPath,
    commit: resolvedCommit,
    generated_at: new Date().toISOString(),
    stats: {
      total_files: files.length,
      source_files: files.filter((file) => /\.(py|ts|tsx|js|jsx|go|rs|java)$/.test(file)).length,
      config_files: files.filter((file) => /\.(yaml|yml|toml|json|ini|cfg)$/.test(file)).length,
      script_files: files.filter((file) => /\.(sh|bash|zsh)$/.test(file)).length,
      test_files: files.filter((file) => /test/i.test(file)).length,
    },
    entrypoints: files.filter((file) => /(^|\/)(main|app|index|train|eval|run)\./i.test(file)).slice(0, 40),
    files_sample: files.slice(0, 200),
  };

  const interfaceCards = buildInterfaceCards(files);
  const capabilities = deriveCapabilities(files);
  const capabilitiesYaml = toYaml(capabilities);

  const payload = {
    repo_map: repoMap,
    interface_cards: interfaceCards,
    configs_schema: {
      commit: resolvedCommit,
      detected_config_files: files.filter((file) => /config|\.ya?ml$|\.toml$|\.json$/i.test(file)).slice(0, 200),
      generated_at: new Date().toISOString(),
    },
    capabilities_yaml: capabilitiesYaml,
  };

  // Persist cache locally for deterministic API responses and quick reloads.
  await writeLocalRepoMapArtifacts(localCacheRoot, payload);

  return {
    commit: resolvedCommit,
    cacheRoot,
    ...payload,
    cached: false,
  };
}

module.exports = {
  buildRepoMap,
};
