const crypto = require('crypto');
const path = require('path');
const { getDb } = require('../../db');
const s3Service = require('../s3.service');

const ASSET_TYPES = new Set(['document', 'insight', 'file', 'note', 'report']);

function normalizeUserId(userId) {
  const raw = String(userId || '').trim().toLowerCase();
  return raw || 'czk';
}

function cleanString(value) {
  return String(value || '').trim();
}

function toInt(value, fallback, min = 0, max = 100000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function normalizeAssetType(value, fallback = 'insight') {
  const next = cleanString(value).toLowerCase();
  if (ASSET_TYPES.has(next)) return next;
  return fallback;
}

function normalizeIdList(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const id = Number(raw);
    if (!Number.isFinite(id)) continue;
    const normalized = Math.floor(id);
    if (normalized <= 0 || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function mapAssetRow(row = {}, { includeBody = false } = {}) {
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: Number(row.id),
    userId: row.user_id,
    assetType: row.asset_type,
    title: row.title,
    summary: row.summary || null,
    bodyMd: includeBody ? (row.body_md || '') : undefined,
    source: {
      provider: row.source_provider || null,
      sessionId: row.source_session_id || null,
      messageId: row.source_message_id || null,
      url: row.source_url || null,
    },
    file: {
      objectKey: row.object_key || null,
      mimeType: row.mime_type || null,
      sizeBytes: Number(row.size_bytes || 0) || null,
      contentSha256: row.content_sha256 || null,
    },
    externalDocumentId: row.external_document_id ? Number(row.external_document_id) : null,
    tags: parseJsonArray(row.tags),
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureGroupOwnership(db, userId, groupId) {
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) {
    throw new Error('Invalid group id');
  }
  const uid = normalizeUserId(userId);
  const result = await db.execute({
    sql: `SELECT id FROM knowledge_groups WHERE id = ? AND user_id = ?`,
    args: [gid, uid],
  });
  if (!result.rows.length) {
    const error = new Error('Knowledge group not found');
    error.code = 'GROUP_NOT_FOUND';
    throw error;
  }
  return gid;
}

async function validateExternalDocument(db, userId, externalDocumentId) {
  if (externalDocumentId === undefined || externalDocumentId === null) return null;
  const docId = Number(externalDocumentId);
  if (!Number.isFinite(docId) || docId <= 0) throw new Error('Invalid externalDocumentId');
  const uid = normalizeUserId(userId);
  const result = await db.execute({
    sql: `SELECT id FROM documents WHERE id = ? AND user_id = ?`,
    args: [docId, uid],
  });
  if (!result.rows.length) {
    const error = new Error('Document not found for externalDocumentId');
    error.code = 'DOCUMENT_NOT_FOUND';
    throw error;
  }
  return docId;
}

async function touchGroup(db, userId, groupId) {
  const uid = normalizeUserId(userId);
  await db.execute({
    sql: `UPDATE knowledge_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
    args: [groupId, uid],
  });
}

async function getAssetRow(userId, assetId) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const result = await db.execute({
    sql: `SELECT * FROM knowledge_assets WHERE id = ? AND user_id = ?`,
    args: [id, uid],
  });
  return result.rows?.[0] || null;
}

async function getKnowledgeAsset(userId, assetId, { includeBody = true } = {}) {
  const row = await getAssetRow(userId, assetId);
  return row ? mapAssetRow(row, { includeBody }) : null;
}

async function listKnowledgeAssets(userId, {
  limit = 20,
  offset = 0,
  q = '',
  assetType = '',
  provider = '',
  groupId = null,
  includeBody = false,
  ids = [],
} = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const cap = toInt(limit, 20, 1, 200);
  const skip = toInt(offset, 0, 0, 200000);
  const query = cleanString(q);
  const normalizedType = cleanString(assetType).toLowerCase();
  const normalizedProvider = cleanString(provider).toLowerCase();
  const assetIds = normalizeIdList(ids);
  const gid = groupId !== null && groupId !== undefined ? Number(groupId) : null;

  const joins = [];
  const where = ['ka.user_id = ?'];
  const args = [uid];

  if (gid && Number.isFinite(gid) && gid > 0) {
    joins.push('JOIN knowledge_group_assets kga ON kga.asset_id = ka.id');
    joins.push('JOIN knowledge_groups kg ON kg.id = kga.group_id');
    where.push('kg.id = ?');
    where.push('kg.user_id = ?');
    args.push(gid, uid);
  }

  if (query) {
    where.push('(ka.title LIKE ? OR IFNULL(ka.summary, \'\') LIKE ? OR IFNULL(ka.body_md, \'\') LIKE ?)');
    args.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }

  if (normalizedType && ASSET_TYPES.has(normalizedType)) {
    where.push('ka.asset_type = ?');
    args.push(normalizedType);
  }

  if (normalizedProvider) {
    where.push('LOWER(IFNULL(ka.source_provider, \'\')) = ?');
    args.push(normalizedProvider);
  }

  if (assetIds.length) {
    where.push(`ka.id IN (${placeholders(assetIds.length)})`);
    args.push(...assetIds);
  }

  const whereClause = where.join(' AND ');
  const joinClause = joins.length ? `${joins.join('\n')}` : '';

  const countResult = await db.execute({
    sql: `
      SELECT COUNT(DISTINCT ka.id) AS total
      FROM knowledge_assets ka
      ${joinClause}
      WHERE ${whereClause}
    `,
    args,
  });
  const total = Number(countResult.rows?.[0]?.total || 0);

  const rowsResult = await db.execute({
    sql: `
      SELECT
        ka.*
      FROM knowledge_assets ka
      ${joinClause}
      WHERE ${whereClause}
      GROUP BY ka.id
      ORDER BY ka.updated_at DESC, ka.id DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, cap, skip],
  });

  const items = rowsResult.rows.map((row) => mapAssetRow(row, { includeBody }));
  return {
    items,
    total,
    hasMore: skip + items.length < total,
    offset: skip,
    limit: cap,
  };
}

async function getNextAssetVersion(db, assetId) {
  const result = await db.execute({
    sql: `SELECT COALESCE(MAX(version), 0) AS max_version FROM knowledge_asset_versions WHERE asset_id = ?`,
    args: [assetId],
  });
  return Number(result.rows?.[0]?.max_version || 0) + 1;
}

async function saveAssetVersion(db, assetId, { bodyMd = '', metadata = {} } = {}) {
  const version = await getNextAssetVersion(db, assetId);
  await db.execute({
    sql: `
      INSERT INTO knowledge_asset_versions (asset_id, version, body_md, metadata_json)
      VALUES (?, ?, ?, ?)
    `,
    args: [
      assetId,
      version,
      bodyMd || '',
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {}),
    ],
  });
}

async function createKnowledgeAsset(userId, payload = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const assetType = normalizeAssetType(payload.assetType, 'insight');
  const title = cleanString(payload.title);
  if (!title) throw new Error('title is required');

  const summary = cleanString(payload.summary) || null;
  const bodyMd = typeof payload.bodyMd === 'string' ? payload.bodyMd : '';
  const source = payload.source && typeof payload.source === 'object' ? payload.source : {};
  const sourceProvider = cleanString(source.provider || payload.sourceProvider) || null;
  const sourceSessionId = cleanString(source.sessionId || payload.sourceSessionId) || null;
  const sourceMessageId = cleanString(source.messageId || payload.sourceMessageId) || null;
  const sourceUrl = cleanString(source.url || payload.sourceUrl) || null;
  const objectKey = cleanString(payload.objectKey) || null;
  const mimeType = cleanString(payload.mimeType) || null;
  const sizeBytes = Number(payload.sizeBytes);
  const contentSha256 = cleanString(payload.contentSha256) || null;
  const externalDocumentId = await validateExternalDocument(db, uid, payload.externalDocumentId);
  const tags = Array.isArray(payload.tags) ? payload.tags.map((item) => cleanString(item)).filter(Boolean) : [];
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

  const insertResult = await db.execute({
    sql: `
      INSERT INTO knowledge_assets (
        user_id,
        asset_type,
        title,
        summary,
        body_md,
        external_document_id,
        source_provider,
        source_session_id,
        source_message_id,
        source_url,
        object_key,
        mime_type,
        size_bytes,
        content_sha256,
        tags,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    args: [
      uid,
      assetType,
      title,
      summary,
      bodyMd || null,
      externalDocumentId,
      sourceProvider,
      sourceSessionId,
      sourceMessageId,
      sourceUrl,
      objectKey,
      mimeType,
      Number.isFinite(sizeBytes) && sizeBytes >= 0 ? Math.floor(sizeBytes) : null,
      contentSha256,
      JSON.stringify(tags),
      JSON.stringify(metadata),
    ],
  });
  const assetId = Number(insertResult.lastInsertRowid);

  if (bodyMd || Object.keys(metadata).length > 0) {
    await saveAssetVersion(db, assetId, { bodyMd, metadata });
  }

  const groupIds = normalizeIdList(payload.groupIds);
  if (groupIds.length > 0) {
    for (const groupId of groupIds) {
      // eslint-disable-next-line no-await-in-loop
      await ensureGroupOwnership(db, uid, groupId);
      // eslint-disable-next-line no-await-in-loop
      await db.execute({
        sql: `INSERT OR IGNORE INTO knowledge_group_assets (group_id, asset_id) VALUES (?, ?)`,
        args: [groupId, assetId],
      });
      // eslint-disable-next-line no-await-in-loop
      await touchGroup(db, uid, groupId);
    }
  }

  return getKnowledgeAsset(uid, assetId, { includeBody: true });
}

function sanitizeFilename(filename = 'asset.bin') {
  const base = path.basename(String(filename || 'asset.bin'));
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || 'asset.bin';
}

function guessAssetTypeFromMime(mimeType = '') {
  const mime = String(mimeType || '').toLowerCase();
  if (!mime) return 'file';
  if (mime.includes('markdown') || mime.includes('text/plain')) return 'note';
  if (mime.includes('json')) return 'note';
  return 'file';
}

async function createKnowledgeAssetFromUpload(userId, payload = {}, file = null) {
  if (!file || !file.buffer) {
    throw new Error('file is required');
  }
  const uid = normalizeUserId(userId);
  const now = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const safeName = sanitizeFilename(file.originalname || payload.filename || 'asset.bin');
  const objectKey = `${uid}/knowledge-assets/${now}-${random}-${safeName}`;
  const mimeType = cleanString(file.mimetype) || 'application/octet-stream';
  const contentSha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

  await s3Service.uploadBuffer(file.buffer, objectKey, mimeType);

  return createKnowledgeAsset(uid, {
    assetType: normalizeAssetType(payload.assetType, guessAssetTypeFromMime(mimeType)),
    title: cleanString(payload.title) || safeName,
    summary: payload.summary,
    bodyMd: payload.bodyMd,
    source: payload.source,
    sourceProvider: payload.sourceProvider,
    sourceSessionId: payload.sourceSessionId,
    sourceMessageId: payload.sourceMessageId,
    sourceUrl: payload.sourceUrl,
    objectKey,
    mimeType,
    sizeBytes: file.buffer.length,
    contentSha256,
    tags: payload.tags,
    metadata: payload.metadata,
    externalDocumentId: payload.externalDocumentId,
    groupIds: payload.groupIds,
  });
}

async function updateKnowledgeAsset(userId, assetId, payload = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid asset id');

  const current = await getAssetRow(uid, id);
  if (!current) return null;

  const updates = [];
  const args = [];
  let nextBodyMd = current.body_md || '';
  let nextMetadata = parseJsonObject(current.metadata_json);
  let versionChanged = false;

  if (payload.title !== undefined) {
    const title = cleanString(payload.title);
    if (!title) throw new Error('title cannot be empty');
    updates.push('title = ?');
    args.push(title);
  }
  if (payload.summary !== undefined) {
    updates.push('summary = ?');
    args.push(cleanString(payload.summary) || null);
  }
  if (payload.bodyMd !== undefined) {
    nextBodyMd = typeof payload.bodyMd === 'string' ? payload.bodyMd : '';
    updates.push('body_md = ?');
    args.push(nextBodyMd || null);
    versionChanged = true;
  }
  if (payload.assetType !== undefined) {
    updates.push('asset_type = ?');
    args.push(normalizeAssetType(payload.assetType, normalizeAssetType(current.asset_type)));
  }
  if (payload.tags !== undefined) {
    const tags = Array.isArray(payload.tags) ? payload.tags.map((item) => cleanString(item)).filter(Boolean) : [];
    updates.push('tags = ?');
    args.push(JSON.stringify(tags));
  }
  if (payload.metadata !== undefined) {
    nextMetadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    updates.push('metadata_json = ?');
    args.push(JSON.stringify(nextMetadata));
    versionChanged = true;
  }
  if (payload.source !== undefined || payload.sourceProvider !== undefined) {
    const source = payload.source && typeof payload.source === 'object' ? payload.source : {};
    updates.push('source_provider = ?');
    args.push(cleanString(source.provider || payload.sourceProvider) || null);
    updates.push('source_session_id = ?');
    args.push(cleanString(source.sessionId || payload.sourceSessionId) || null);
    updates.push('source_message_id = ?');
    args.push(cleanString(source.messageId || payload.sourceMessageId) || null);
    updates.push('source_url = ?');
    args.push(cleanString(source.url || payload.sourceUrl) || null);
  }

  if (!updates.length) {
    return getKnowledgeAsset(uid, id, { includeBody: true });
  }

  await db.execute({
    sql: `
      UPDATE knowledge_assets
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    args: [...args, id, uid],
  });

  if (versionChanged) {
    await saveAssetVersion(db, id, { bodyMd: nextBodyMd, metadata: nextMetadata });
  }

  return getKnowledgeAsset(uid, id, { includeBody: true });
}

async function deleteKnowledgeAsset(userId, assetId) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid asset id');

  const row = await getAssetRow(uid, id);
  if (!row) return false;

  if (row.object_key && row.asset_type !== 'document') {
    s3Service.deleteObject(row.object_key).catch((error) => {
      console.warn('[KnowledgeAssets] Failed to delete object from storage:', error.message);
    });
  }

  await db.execute({
    sql: `DELETE FROM knowledge_assets WHERE id = ? AND user_id = ?`,
    args: [id, uid],
  });
  return true;
}

async function listKnowledgeGroupAssets(userId, groupId, { limit = 20, offset = 0, q = '', includeBody = false } = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = await ensureGroupOwnership(db, uid, groupId);
  return listKnowledgeAssets(uid, {
    limit,
    offset,
    q,
    groupId: gid,
    includeBody,
  });
}

async function addAssetsToKnowledgeGroup(userId, groupId, assetIds = []) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = await ensureGroupOwnership(db, uid, groupId);
  const ids = normalizeIdList(assetIds);
  if (!ids.length) return { added: 0, ignored: 0, validAssetIds: [] };

  const validResult = await db.execute({
    sql: `SELECT id FROM knowledge_assets WHERE user_id = ? AND id IN (${placeholders(ids.length)})`,
    args: [uid, ...ids],
  });
  const validIds = validResult.rows.map((row) => Number(row.id));
  if (!validIds.length) return { added: 0, ignored: ids.length, validAssetIds: [] };

  let added = 0;
  for (const assetId of validIds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await db.execute({
      sql: `INSERT OR IGNORE INTO knowledge_group_assets (group_id, asset_id) VALUES (?, ?)`,
      args: [gid, assetId],
    });
    added += Number(result.rowsAffected || 0) > 0 ? 1 : 0;
  }
  await touchGroup(db, uid, gid);

  return {
    added,
    ignored: ids.length - added,
    validAssetIds: validIds,
  };
}

async function removeAssetFromKnowledgeGroup(userId, groupId, assetId) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = await ensureGroupOwnership(db, uid, groupId);
  const id = Number(assetId);
  if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid asset id');

  await db.execute({
    sql: `
      DELETE FROM knowledge_group_assets
      WHERE group_id = ? AND asset_id IN (
        SELECT id FROM knowledge_assets WHERE id = ? AND user_id = ?
      )
    `,
    args: [gid, id, uid],
  });
  await touchGroup(db, uid, gid);
  return true;
}

async function listAssetsByIds(userId, assetIds = [], { includeBody = true } = {}) {
  const ids = normalizeIdList(assetIds);
  if (!ids.length) return [];
  const result = await listKnowledgeAssets(userId, {
    ids,
    limit: Math.max(ids.length, 1),
    offset: 0,
    includeBody,
  });
  const byId = new Map(result.items.map((item) => [Number(item.id), item]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

module.exports = {
  listKnowledgeAssets,
  getKnowledgeAsset,
  createKnowledgeAsset,
  createKnowledgeAssetFromUpload,
  updateKnowledgeAsset,
  deleteKnowledgeAsset,
  listKnowledgeGroupAssets,
  addAssetsToKnowledgeGroup,
  removeAssetFromKnowledgeGroup,
  listAssetsByIds,
};
