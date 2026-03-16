const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const MANAGED_BLOCK_ID = 'AUTO_RESEARCHER_ARIS';
const DEFAULT_REPO_URL = process.env.ARIS_SKILLS_REPO || 'https://github.com/CurryTang/Auto-claude-code-research-in-sleep.git';
const DEFAULT_REPO_REF = process.env.ARIS_SKILLS_REF || 'main';
const DEFAULT_CACHE_DIR = process.env.ARIS_SKILLS_CACHE_DIR
  || path.join(os.homedir(), '.cache', 'auto-researcher', 'aris-skills');
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_OVERLAY_DIR = path.join(DEFAULT_ROOT_DIR, 'resource', 'integrations', 'aris', 'overlay');
const DEFAULT_ADAPTER_DIR = path.join(DEFAULT_ROOT_DIR, 'resource', 'integrations', 'aris');

function managedBlockStart(blockId) {
  return `<!-- ${blockId} START -->`;
}

function managedBlockEnd(blockId) {
  return `<!-- ${blockId} END -->`;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_) {
    return false;
  }
}

async function walkFiles(rootDir, currentDir = rootDir) {
  if (!(await pathExists(currentDir))) {
    return [];
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      absolutePath,
      relativePath: path.relative(rootDir, absolutePath).split(path.sep).join('/'),
    });
  }

  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function createClaudeMdContent({ projectName = '', localProjectPath = '' } = {}) {
  const displayName = String(projectName || localProjectPath || 'AIRS Project').trim();
  const localPath = String(localProjectPath || '.').trim() || '.';

  return [
    '## Auto Researcher AIRS',
    '',
    `- Project: ${displayName}`,
    `- Local workspace: ${localPath}`,
    '- AIRS skills are installed project-locally under `.claude/skills/`.',
    '- Use local Claude Code in this project root to access the AIRS slash commands.',
    '',
    '## Paper Library',
    '',
    '- Local PDFs should live in `papers/` or `literature/`.',
    '- `/research-lit` should check the Auto Researcher MCP server first, then local PDFs, then the web.',
    '',
    '## Auto Researcher MCP',
    '',
    '- Register the Auto Researcher MCP server for this project if it is not already configured.',
    '- Preferred name: `auto-researcher`.',
    '- Compatibility alias: `zotero`.',
    '',
    '## Remote Server',
    '',
    '- Add SSH, conda, and remote code-directory details here if AIRS should launch experiments remotely.',
  ].join('\n');
}

function mergeManagedBlock(existingContent, incomingContent, blockId = MANAGED_BLOCK_ID) {
  const startMarker = managedBlockStart(blockId);
  const endMarker = managedBlockEnd(blockId);
  const blockBody = `${startMarker}\n${incomingContent}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
  const trimmedExisting = String(existingContent || '').trimEnd();

  if (!trimmedExisting) {
    return `${blockBody}\n`;
  }
  if (pattern.test(trimmedExisting)) {
    return `${trimmedExisting.replace(pattern, blockBody)}\n`;
  }
  return `${trimmedExisting}\n\n${blockBody}\n`;
}

async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function updateCachedSource(cacheDir, repoUrl, repoRef) {
  await fs.mkdir(path.dirname(cacheDir), { recursive: true });
  const gitDir = path.join(cacheDir, '.git');

  if (!(await pathExists(gitDir))) {
    await execFileAsync('git', ['clone', '--depth', '1', '--branch', repoRef, repoUrl, cacheDir]);
    return cacheDir;
  }

  const status = await execFileAsync('git', ['-C', cacheDir, 'status', '--short']);
  if (String(status.stdout || '').trim()) {
    throw new Error(`Refusing to update AIRS cache at ${cacheDir} because it has local changes.`);
  }

  await execFileAsync('git', ['-C', cacheDir, 'remote', 'set-url', 'origin', repoUrl]);
  await execFileAsync('git', ['-C', cacheDir, 'fetch', '--depth', '1', 'origin', repoRef]);
  await execFileAsync('git', ['-C', cacheDir, 'checkout', '-B', 'auto-researcher-integration', 'FETCH_HEAD']);
  return cacheDir;
}

function createArisProjectFilesService(overrides = {}) {
  const repoUrl = overrides.repoUrl || DEFAULT_REPO_URL;
  const repoRef = overrides.repoRef || DEFAULT_REPO_REF;
  const cacheDir = overrides.cacheDir || DEFAULT_CACHE_DIR;
  const overlayDir = overrides.overlayDir || DEFAULT_OVERLAY_DIR;
  const adapterDir = overrides.adapterDir || DEFAULT_ADAPTER_DIR;
  const sourceDirOverride = overrides.sourceDir || process.env.ARIS_PROJECT_FILES_SOURCE_DIR || '';

  async function resolveSourceDir() {
    if (sourceDirOverride) {
      return sourceDirOverride;
    }
    return updateCachedSource(cacheDir, repoUrl, repoRef);
  }

  async function buildProjectFiles({ projectName = '', localProjectPath = '' } = {}) {
    const sourceDir = await resolveSourceDir();
    const skillSourceDir = path.join(sourceDir, 'skills');
    const sourceFiles = await walkFiles(skillSourceDir);
    const projectFiles = [];

    for (const file of sourceFiles) {
      projectFiles.push({
        path: `.claude/skills/${file.relativePath}`,
        content: await fs.readFile(file.absolutePath, 'utf8'),
        writeMode: 'replace',
      });
    }

    const overlayFiles = await walkFiles(overlayDir);
    for (const file of overlayFiles) {
      const targetPath = `.claude/${file.relativePath}`;
      const existingIndex = projectFiles.findIndex((entry) => entry.path === targetPath);
      const nextFile = {
        path: targetPath,
        content: await fs.readFile(file.absolutePath, 'utf8'),
        writeMode: 'replace',
      };
      if (existingIndex >= 0) {
        projectFiles.splice(existingIndex, 1, nextFile);
      } else {
        projectFiles.push(nextFile);
      }
    }

    // Include the review adapter script (used by auto-review-loop skill)
    const adapterPath = path.join(adapterDir, 'review-adapter.py');
    if (await pathExists(adapterPath)) {
      projectFiles.push({
        path: '.claude/review-adapter.py',
        content: await fs.readFile(adapterPath, 'utf8'),
        writeMode: 'replace',
      });
    }

    projectFiles.push({
      path: 'CLAUDE.md',
      content: createClaudeMdContent({ projectName, localProjectPath }),
      writeMode: 'managed_block',
      blockId: MANAGED_BLOCK_ID,
    });

    return projectFiles.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function materializeProjectFiles(targetDir, files) {
    for (const file of files) {
      const destination = path.join(targetDir, file.path);
      await ensureParentDirectory(destination);

      if (file.writeMode === 'managed_block') {
        const existingContent = await fs.readFile(destination, 'utf8').catch(() => '');
        const merged = mergeManagedBlock(existingContent, file.content, file.blockId || MANAGED_BLOCK_ID);
        await fs.writeFile(destination, merged, 'utf8');
        continue;
      }

      await fs.writeFile(destination, file.content, 'utf8');
    }
  }

  return {
    buildProjectFiles,
    materializeProjectFiles,
  };
}

module.exports = {
  MANAGED_BLOCK_ID,
  createArisProjectFilesService,
  createClaudeMdContent,
  mergeManagedBlock,
};
