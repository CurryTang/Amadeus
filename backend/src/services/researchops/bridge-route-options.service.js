'use strict';

function parseBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return raw !== 0;
  const normalized = String(raw).trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseLimit(raw, fallback = 1, max = 64) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readBridgeContextOptions(query = {}) {
  return {
    includeContextPack: parseBoolean(query?.includeContextPack, false),
    includeReport: parseBoolean(query?.includeReport, false),
  };
}

function readBridgeRunOptions(body = {}) {
  return {
    force: parseBoolean(body?.force, false),
    preflightOnly: parseBoolean(body?.preflightOnly, false),
    searchTrialCount: parseLimit(body?.searchTrialCount, 1, 64),
    clarifyMessages: Array.isArray(body?.clarifyMessages) ? body.clarifyMessages : [],
    workspaceSnapshot: asObject(body?.workspaceSnapshot),
    localSnapshot: asObject(body?.localSnapshot),
  };
}

module.exports = {
  readBridgeContextOptions,
  readBridgeRunOptions,
};
