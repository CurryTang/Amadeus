'use strict';

const { buildIdeaListPayload } = require('./idea-payload.service');
const { buildProjectListPayload } = require('./project-location.service');
const { buildQueueListPayload } = require('./queue-payload.service');
const { buildRunListPayload } = require('./run-list-payload.service');
const { buildSkillListPayload } = require('./skill-payload.service');

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function buildDashboardPayload({
  projects = [],
  ideas = [],
  queue = [],
  runs = [],
  skills = [],
  projectLimit = 80,
  itemLimit = 120,
  refreshedAt = '',
} = {}) {
  const normalizedProjectLimit = normalizeLimit(projectLimit, 80);
  const normalizedItemLimit = normalizeLimit(itemLimit, 120);
  return {
    projects: buildProjectListPayload({
      items: projects,
      limit: normalizedProjectLimit,
    }).items,
    ideas: buildIdeaListPayload({
      items: ideas,
      limit: normalizedItemLimit,
    }).items,
    queue: buildQueueListPayload({
      items: queue,
      limit: normalizedItemLimit,
    }).items,
    runs: buildRunListPayload({
      page: {
        items: runs,
      },
      limit: normalizedItemLimit,
    }).items,
    skills: buildSkillListPayload({
      items: skills,
    }).items,
    filters: {
      projectLimit: normalizedProjectLimit,
      itemLimit: normalizedItemLimit,
    },
    refreshedAt: typeof refreshedAt === 'string' ? refreshedAt.trim() || null : null,
    actions: {
      dashboard: {
        method: 'GET',
        path: '/researchops/dashboard',
      },
    },
  };
}

module.exports = {
  buildDashboardPayload,
};
