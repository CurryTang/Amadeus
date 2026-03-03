'use strict';

const os = require('os');

function parseLimit(raw, fallback = 50, max = 300) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 1), max);
}

function parseOffset(raw, fallback = 0, max = 100000) {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), 0), max);
}

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

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getUserId(req) {
  return req.userId || 'czk';
}

function sanitizeError(error, fallback) {
  return error?.message || fallback;
}

function parseMaybeJson(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch (_) { return fallback; }
}

function expandHome(inputPath = '') {
  return String(inputPath || '').replace(/^~(?=\/|$)/, os.homedir());
}

function buildArtifactDownloadPath(runId = '', artifactId = '') {
  const rid = encodeURIComponent(String(runId || '').trim());
  const aid = encodeURIComponent(String(artifactId || '').trim());
  if (!rid || !aid) return null;
  return `/api/researchops/runs/${rid}/artifacts/${aid}/download`;
}

function withArtifactDownloadUrl(artifact = null, runId = '') {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const downloadPath = buildArtifactDownloadPath(runId, artifact.id);
  if (!downloadPath) return artifact;
  return {
    ...artifact,
    objectUrl: artifact.objectKey ? downloadPath : (artifact.objectUrl || downloadPath),
  };
}

module.exports = {
  parseLimit,
  parseOffset,
  parseBoolean,
  cleanString,
  getUserId,
  sanitizeError,
  parseMaybeJson,
  expandHome,
  buildArtifactDownloadPath,
  withArtifactDownloadUrl,
};
