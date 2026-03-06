import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LAUNCHER_SKILL,
  LAUNCHER_VISIBLE_SKILLS,
  getLauncherPromptPrefix,
} from './launcherRouting.js';

test('single runner defaults to auto mode', () => {
  assert.equal(DEFAULT_LAUNCHER_SKILL, 'auto');
  assert.deepEqual(LAUNCHER_VISIBLE_SKILLS, ['auto']);
});

test('auto mode prompt tells agent to choose implementation or experiment', () => {
  const prefix = getLauncherPromptPrefix('auto');

  assert.match(prefix, /implementation task/i);
  assert.match(prefix, /experiment task/i);
  assert.match(prefix, /decide which path fits/i);
});

test('fallback routing also resolves to auto prompt', () => {
  assert.equal(getLauncherPromptPrefix('implement'), getLauncherPromptPrefix('auto'));
  assert.equal(getLauncherPromptPrefix('experiment'), getLauncherPromptPrefix('auto'));
  assert.equal(getLauncherPromptPrefix('custom'), getLauncherPromptPrefix('auto'));
});
