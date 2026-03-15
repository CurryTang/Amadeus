const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  createArisProjectFilesService,
} = require('../arisProjectFiles.service');

async function makeTempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('buildProjectFiles maps upstream AIRS skills into project-local .claude/skills and applies overlays', async () => {
  const tempRoot = await makeTempDir('aris-project-files-');
  const sourceDir = path.join(tempRoot, 'source');
  const overlayDir = path.join(tempRoot, 'resource', 'integrations', 'aris', 'overlay');

  await fs.mkdir(path.join(sourceDir, 'skills', 'research-lit'), { recursive: true });
  await fs.mkdir(path.join(sourceDir, 'skills', 'idea-discovery'), { recursive: true });
  await fs.mkdir(path.join(overlayDir, 'skills', 'research-lit'), { recursive: true });

  await fs.writeFile(
    path.join(sourceDir, 'skills', 'research-lit', 'SKILL.md'),
    '# upstream research lit\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(sourceDir, 'skills', 'idea-discovery', 'SKILL.md'),
    '# upstream idea discovery\n',
    'utf8'
  );
  await fs.writeFile(
    path.join(overlayDir, 'skills', 'research-lit', 'SKILL.md'),
    '# overlay research lit\n',
    'utf8'
  );

  const service = createArisProjectFilesService({
    sourceDir,
    overlayDir,
  });

  const files = await service.buildProjectFiles({
    projectName: 'Paper Agent',
    localProjectPath: 'paper-agent',
  });

  const paths = files.map((entry) => entry.path).sort();
  assert.deepEqual(paths, [
    '.claude/skills/idea-discovery/SKILL.md',
    '.claude/skills/research-lit/SKILL.md',
    'CLAUDE.md',
  ]);

  const researchLit = files.find((entry) => entry.path === '.claude/skills/research-lit/SKILL.md');
  const claudeMd = files.find((entry) => entry.path === 'CLAUDE.md');

  assert.equal(researchLit.content, '# overlay research lit\n');
  assert.equal(claudeMd.writeMode, 'managed_block');
  assert.match(claudeMd.content, /Paper Agent/);
  assert.match(claudeMd.content, /papers\//);
});

test('materializeProjectFiles writes nested AIRS skills and merges the managed CLAUDE.md block', async () => {
  const tempRoot = await makeTempDir('aris-project-materialize-');
  const targetDir = path.join(tempRoot, 'target');

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(
    path.join(targetDir, 'CLAUDE.md'),
    '# User Notes\n\nKeep this content.\n',
    'utf8'
  );

  const service = createArisProjectFilesService({
    sourceDir: path.join(tempRoot, 'unused-source'),
    overlayDir: path.join(tempRoot, 'unused-overlay'),
  });

  await service.materializeProjectFiles(targetDir, [
    {
      path: '.claude/skills/research-pipeline/SKILL.md',
      content: '# pipeline\n',
      writeMode: 'replace',
    },
    {
      path: 'CLAUDE.md',
      content: 'Managed AIRS block',
      writeMode: 'managed_block',
      blockId: 'AUTO_RESEARCHER_ARIS',
    },
  ]);

  const skillBody = await fs.readFile(
    path.join(targetDir, '.claude', 'skills', 'research-pipeline', 'SKILL.md'),
    'utf8'
  );
  const claudeBody = await fs.readFile(path.join(targetDir, 'CLAUDE.md'), 'utf8');

  assert.equal(skillBody, '# pipeline\n');
  assert.match(claudeBody, /Keep this content\./);
  assert.match(claudeBody, /AUTO_RESEARCHER_ARIS START/);
  assert.match(claudeBody, /Managed AIRS block/);
});
