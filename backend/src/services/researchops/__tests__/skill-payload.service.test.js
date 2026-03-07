'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSkillListPayload,
  buildSkillContentPayload,
  buildSkillSyncPayload,
} = require('../skill-payload.service');

test('buildSkillListPayload keeps skill items compatible while exposing actions', () => {
  const payload = buildSkillListPayload({
    items: [
      {
        id: 'skill_report',
        name: 'deliverable-report',
        source: 'repo-skills-local-unsynced',
        version: '1.0.0',
      },
    ],
  });

  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, 'skill_report');
  assert.equal(payload.items[0].name, 'deliverable-report');
  assert.deepEqual(payload.items[0].actions.content, {
    method: 'GET',
    path: '/researchops/skills/skill_report/content',
  });
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/skills',
  });
  assert.deepEqual(payload.actions.sync, {
    method: 'POST',
    path: '/researchops/skills/sync',
  });
});

test('buildSkillContentPayload preserves content root while exposing follow-up actions', () => {
  const payload = buildSkillContentPayload({
    skillId: 'skill_report',
    content: '# Skill',
  });

  assert.equal(payload.skillId, 'skill_report');
  assert.equal(payload.content, '# Skill');
  assert.deepEqual(payload.actions.content, {
    method: 'GET',
    path: '/researchops/skills/skill_report/content',
  });
  assert.deepEqual(payload.actions.updateContent, {
    method: 'PUT',
    path: '/researchops/skills/skill_report/content',
  });
});

test('buildSkillContentPayload can mark saved content without changing follow-up actions', () => {
  const payload = buildSkillContentPayload({
    skillId: 'skill_report',
    content: '# Skill',
    ok: true,
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.skillId, 'skill_report');
  assert.equal(payload.content, '# Skill');
  assert.deepEqual(payload.actions.updateContent, {
    method: 'PUT',
    path: '/researchops/skills/skill_report/content',
  });
});

test('buildSkillSyncPayload exposes sync result and list follow-up action', () => {
  const payload = buildSkillSyncPayload({
    result: {
      syncedCount: 3,
      uploaded: ['skill_report'],
    },
  });

  assert.equal(payload.syncedCount, 3);
  assert.deepEqual(payload.uploaded, ['skill_report']);
  assert.deepEqual(payload.actions.list, {
    method: 'GET',
    path: '/researchops/skills',
  });
  assert.deepEqual(payload.actions.sync, {
    method: 'POST',
    path: '/researchops/skills/sync',
  });
});
