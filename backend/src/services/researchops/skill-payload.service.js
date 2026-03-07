'use strict';

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildSkillActions(skillId = '') {
  const safeSkillId = cleanString(skillId);
  if (!safeSkillId) return {};
  const encodedSkillId = encodeURIComponent(safeSkillId);
  return {
    content: {
      method: 'GET',
      path: `/researchops/skills/${encodedSkillId}/content`,
    },
    updateContent: {
      method: 'PUT',
      path: `/researchops/skills/${encodedSkillId}/content`,
    },
  };
}

function normalizeSkill(skill = null) {
  const source = skill && typeof skill === 'object' ? skill : {};
  const skillId = cleanString(source.id);
  return {
    ...source,
    id: skillId || null,
    actions: buildSkillActions(skillId),
  };
}

function buildSkillListPayload({ items = [] } = {}) {
  return {
    items: (Array.isArray(items) ? items : []).map((item) => normalizeSkill(item)),
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/skills',
      },
      sync: {
        method: 'POST',
        path: '/researchops/skills/sync',
      },
    },
  };
}

function buildSkillContentPayload({
  skillId = '',
  content = '',
} = {}) {
  const safeSkillId = cleanString(skillId);
  return {
    skillId: safeSkillId || null,
    content: typeof content === 'string' ? content : '',
    actions: buildSkillActions(safeSkillId),
  };
}

function buildSkillSyncPayload({ result = null } = {}) {
  const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
  return {
    ...source,
    syncedCount: Number.isFinite(Number(source.syncedCount)) ? Number(source.syncedCount) : 0,
    uploaded: Array.isArray(source.uploaded) ? source.uploaded : [],
    actions: {
      list: {
        method: 'GET',
        path: '/researchops/skills',
      },
      sync: {
        method: 'POST',
        path: '/researchops/skills/sync',
      },
    },
  };
}

module.exports = {
  buildSkillListPayload,
  buildSkillContentPayload,
  buildSkillSyncPayload,
};
