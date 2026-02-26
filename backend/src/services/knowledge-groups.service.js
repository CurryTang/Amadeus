const { getDb } = require('../db');

function normalizeUserId(userId) {
  const raw = String(userId || '').trim().toLowerCase();
  return raw || 'czk';
}

function cleanString(value) {
  return String(value || '').trim();
}

function toInt(value, fallback, min = 0, max = 1000) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.floor(num), min), max);
}

function normalizeDocumentIds(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const num = Number(item);
    if (!Number.isFinite(num)) continue;
    const id = Math.floor(num);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

async function listKnowledgeGroups(userId, { limit = 20, offset = 0, q = '', ids = [] } = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const cap = toInt(limit, 20, 1, 200);
  const skip = toInt(offset, 0, 0, 100000);
  const query = cleanString(q);
  const groupIds = normalizeDocumentIds(ids);

  const where = ['kg.user_id = ?'];
  const args = [uid];

  if (query) {
    where.push('(kg.name LIKE ? OR kg.description LIKE ?)');
    args.push(`%${query}%`, `%${query}%`);
  }

  if (groupIds.length) {
    where.push(`kg.id IN (${placeholders(groupIds.length)})`);
    args.push(...groupIds);
  }

  const whereClause = where.join(' AND ');
  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS total FROM knowledge_groups kg WHERE ${whereClause}`,
    args,
  });
  const total = Number(countResult.rows?.[0]?.total || 0);

  const rows = await db.execute({
    sql: `
      SELECT
        kg.id,
        kg.name,
        kg.description,
        kg.created_at,
        kg.updated_at,
        COUNT(d.id) AS document_count
      FROM knowledge_groups kg
      LEFT JOIN knowledge_group_documents kgd ON kgd.group_id = kg.id
      LEFT JOIN documents d ON d.id = kgd.document_id AND d.user_id = kg.user_id
      WHERE ${whereClause}
      GROUP BY kg.id
      ORDER BY kg.updated_at DESC, kg.id DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, cap, skip],
  });

  return {
    items: rows.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      description: row.description || null,
      documentCount: Number(row.document_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    total,
    hasMore: skip + rows.rows.length < total,
    offset: skip,
    limit: cap,
  };
}

async function getKnowledgeGroup(userId, groupId) {
  const result = await listKnowledgeGroups(userId, { ids: [groupId], limit: 1, offset: 0 });
  return result.items[0] || null;
}

async function createKnowledgeGroup(userId, payload = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const name = cleanString(payload?.name);
  if (!name) throw new Error('name is required');
  const description = cleanString(payload?.description) || null;
  const documentIds = normalizeDocumentIds(payload?.documentIds);

  const insertResult = await db.execute({
    sql: `INSERT INTO knowledge_groups (name, description, user_id) VALUES (?, ?, ?)`,
    args: [name, description, uid],
  });

  const groupId = Number(insertResult.lastInsertRowid);
  if (documentIds.length) {
    await addDocumentsToKnowledgeGroup(uid, groupId, documentIds);
  }
  return getKnowledgeGroup(uid, groupId);
}

async function updateKnowledgeGroup(userId, groupId, payload = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('Invalid group id');
  const updates = [];
  const args = [];

  if (payload.name !== undefined) {
    const name = cleanString(payload.name);
    if (!name) throw new Error('name cannot be empty');
    updates.push('name = ?');
    args.push(name);
  }
  if (payload.description !== undefined) {
    updates.push('description = ?');
    args.push(cleanString(payload.description) || null);
  }
  if (!updates.length) {
    return getKnowledgeGroup(uid, gid);
  }

  await db.execute({
    sql: `
      UPDATE knowledge_groups
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `,
    args: [...args, gid, uid],
  });
  return getKnowledgeGroup(uid, gid);
}

async function deleteKnowledgeGroup(userId, groupId) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('Invalid group id');

  await db.execute({
    sql: `DELETE FROM knowledge_groups WHERE id = ? AND user_id = ?`,
    args: [gid, uid],
  });
  return true;
}

async function listKnowledgeGroupDocuments(userId, groupId, { limit = 12, offset = 0, q = '' } = {}) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('Invalid group id');
  const cap = toInt(limit, 12, 1, 100);
  const skip = toInt(offset, 0, 0, 100000);
  const query = cleanString(q);

  const where = ['kg.id = ?', 'kg.user_id = ?', 'd.user_id = ?'];
  const args = [gid, uid, uid];
  if (query) {
    where.push('(d.title LIKE ? OR IFNULL(d.original_url, \'\') LIKE ?)');
    args.push(`%${query}%`, `%${query}%`);
  }
  const whereClause = where.join(' AND ');

  const countResult = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM knowledge_group_documents kgd
      JOIN knowledge_groups kg ON kg.id = kgd.group_id
      JOIN documents d ON d.id = kgd.document_id
      WHERE ${whereClause}
    `,
    args,
  });
  const total = Number(countResult.rows?.[0]?.total || 0);

  const rows = await db.execute({
    sql: `
      SELECT
        d.id,
        d.title,
        d.type,
        d.original_url,
        d.created_at,
        d.tags,
        d.is_read,
        kgd.created_at AS linked_at
      FROM knowledge_group_documents kgd
      JOIN knowledge_groups kg ON kg.id = kgd.group_id
      JOIN documents d ON d.id = kgd.document_id
      WHERE ${whereClause}
      ORDER BY kgd.created_at DESC, d.id DESC
      LIMIT ? OFFSET ?
    `,
    args: [...args, cap, skip],
  });

  return {
    items: rows.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      type: row.type,
      originalUrl: row.original_url || null,
      createdAt: row.created_at,
      linkedAt: row.linked_at,
      tags: safeParseJsonArray(row.tags),
      isRead: Number(row.is_read || 0) === 1,
    })),
    total,
    hasMore: skip + rows.rows.length < total,
    offset: skip,
    limit: cap,
  };
}

function safeParseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function addDocumentsToKnowledgeGroup(userId, groupId, documentIds = []) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = Number(groupId);
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('Invalid group id');
  const ids = normalizeDocumentIds(documentIds);
  if (!ids.length) return { added: 0, ignored: 0, validDocumentIds: [] };

  const group = await getKnowledgeGroup(uid, gid);
  if (!group) {
    const err = new Error('Knowledge group not found');
    err.code = 'GROUP_NOT_FOUND';
    throw err;
  }

  const validResult = await db.execute({
    sql: `
      SELECT id
      FROM documents
      WHERE user_id = ? AND id IN (${placeholders(ids.length)})
    `,
    args: [uid, ...ids],
  });
  const validIds = validResult.rows.map((row) => Number(row.id));
  if (!validIds.length) {
    return { added: 0, ignored: ids.length, validDocumentIds: [] };
  }

  let added = 0;
  for (const docId of validIds) {
    const result = await db.execute({
      sql: `
        INSERT OR IGNORE INTO knowledge_group_documents (group_id, document_id)
        VALUES (?, ?)
      `,
      args: [gid, docId],
    });
    const affected = Number(result.rowsAffected || 0);
    if (affected > 0) added += affected;
  }

  await db.execute({
    sql: `UPDATE knowledge_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
    args: [gid, uid],
  });

  return {
    added,
    ignored: ids.length - added,
    validDocumentIds: validIds,
  };
}

async function removeDocumentFromKnowledgeGroup(userId, groupId, documentId) {
  const db = getDb();
  const uid = normalizeUserId(userId);
  const gid = Number(groupId);
  const did = Number(documentId);
  if (!Number.isFinite(gid) || gid <= 0) throw new Error('Invalid group id');
  if (!Number.isFinite(did) || did <= 0) throw new Error('Invalid document id');

  const group = await getKnowledgeGroup(uid, gid);
  if (!group) {
    const err = new Error('Knowledge group not found');
    err.code = 'GROUP_NOT_FOUND';
    throw err;
  }

  await db.execute({
    sql: `DELETE FROM knowledge_group_documents WHERE group_id = ? AND document_id = ?`,
    args: [gid, did],
  });

  await db.execute({
    sql: `UPDATE knowledge_groups SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`,
    args: [gid, uid],
  });

  return true;
}

module.exports = {
  listKnowledgeGroups,
  getKnowledgeGroup,
  createKnowledgeGroup,
  updateKnowledgeGroup,
  deleteKnowledgeGroup,
  listKnowledgeGroupDocuments,
  addDocumentsToKnowledgeGroup,
  removeDocumentFromKnowledgeGroup,
};
