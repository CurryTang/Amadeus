#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  createArisProjectFilesService,
} = require('../backend/src/services/arisProjectFiles.service');

async function main() {
  const targetDirArg = process.argv[2] || process.cwd();
  const targetDir = path.resolve(targetDirArg);

  await fs.mkdir(targetDir, { recursive: true });

  const service = createArisProjectFilesService();
  const files = await service.buildProjectFiles({
    projectName: path.basename(targetDir),
    localProjectPath: targetDir,
  });

  await service.materializeProjectFiles(targetDir, files);

  console.log(`[aris] Materialized ${files.length} project files into ${targetDir}`);
  console.log(`[aris] AIRS skills are available under ${path.join(targetDir, '.claude', 'skills')}`);
}

main().catch((error) => {
  console.error('[aris] Failed to materialize AIRS project files:', error?.message || error);
  process.exit(1);
});
