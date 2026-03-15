import test from 'node:test';
import assert from 'node:assert/strict';

import {
  materializeProjectFiles,
} from './useClientWorkspaceRegistry.js';

class FakeWritable {
  constructor(fileHandle) {
    this.fileHandle = fileHandle;
  }

  async write(content) {
    this.fileHandle.content = String(content);
  }

  async close() {}
}

class FakeFileHandle {
  constructor(name) {
    this.kind = 'file';
    this.name = name;
    this.content = '';
  }

  async getFile() {
    return {
      text: async () => this.content,
    };
  }

  async createWritable() {
    return new FakeWritable(this);
  }
}

class FakeDirectoryHandle {
  constructor(name) {
    this.kind = 'directory';
    this.name = name;
    this.children = new Map();
  }

  async requestPermission() {
    return 'granted';
  }

  async getDirectoryHandle(name, options = {}) {
    if (!this.children.has(name)) {
      if (!options.create) {
        throw new Error(`Missing directory ${name}`);
      }
      this.children.set(name, new FakeDirectoryHandle(name));
    }
    return this.children.get(name);
  }

  async getFileHandle(name, options = {}) {
    if (!this.children.has(name)) {
      if (!options.create) {
        throw new Error(`Missing file ${name}`);
      }
      this.children.set(name, new FakeFileHandle(name));
    }
    return this.children.get(name);
  }
}

test('materializeProjectFiles writes nested AIRS skills and merges managed CLAUDE.md blocks', async () => {
  const root = new FakeDirectoryHandle('project');
  const claudeFile = await root.getFileHandle('CLAUDE.md', { create: true });
  claudeFile.content = '# Existing Notes\n\nKeep this.\n';

  await materializeProjectFiles(root, [
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

  const dotClaude = await root.getDirectoryHandle('.claude');
  const skills = await dotClaude.getDirectoryHandle('skills');
  const researchPipeline = await skills.getDirectoryHandle('research-pipeline');
  const skillFile = await researchPipeline.getFileHandle('SKILL.md');

  assert.equal(skillFile.content, '# pipeline\n');
  assert.match(claudeFile.content, /Keep this\./);
  assert.match(claudeFile.content, /AUTO_RESEARCHER_ARIS START/);
  assert.match(claudeFile.content, /Managed AIRS block/);
});
