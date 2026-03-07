'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildSkillListPayload } = require('../skill-payload.service');

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
