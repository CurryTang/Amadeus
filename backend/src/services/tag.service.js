const { getDb } = require('../db');

// Predefined color palette for tags
const TAG_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#84cc16', // lime
  '#22c55e', // green
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#ec4899', // pink
];

/**
 * Get a random color from the palette
 */
function getRandomColor() {
  return TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
}

/**
 * Convert database row to tag object
 */
function rowToTag(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    userId: row.user_id,
    createdAt: row.created_at,
  };
}

/**
 * Create a new tag
 * @param {Object} data - Tag data
 * @returns {Promise<Object>}
 */
async function createTag(data) {
  const db = getDb();
  const color = data.color || getRandomColor();

  try {
    const result = await db.execute({
      sql: 'INSERT INTO tags (name, color, user_id) VALUES (?, ?, ?)',
      args: [data.name.toLowerCase().trim(), color, data.userId || 'default_user'],
    });

    const id = Number(result.lastInsertRowid);
    return getTagById(id);
  } catch (error) {
    // If tag already exists, return existing one
    if (error.message.includes('UNIQUE constraint failed')) {
      return getTagByName(data.name, data.userId);
    }
    throw error;
  }
}

/**
 * Get all tags for a user
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>}
 */
async function getTags(userId = 'default_user') {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM tags WHERE user_id = ? ORDER BY name ASC',
    args: [userId],
  });

  return result.rows.map(rowToTag);
}

/**
 * Get a tag by ID
 * @param {number} id - Tag ID
 * @returns {Promise<Object|null>}
 */
async function getTagById(id) {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM tags WHERE id = ?',
    args: [id],
  });

  return rowToTag(result.rows[0]);
}

/**
 * Get a tag by name
 * @param {string} name - Tag name
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>}
 */
async function getTagByName(name, userId = 'default_user') {
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM tags WHERE name = ? AND user_id = ?',
    args: [name.toLowerCase().trim(), userId],
  });

  return rowToTag(result.rows[0]);
}

/**
 * Update a tag
 * @param {number} id - Tag ID
 * @param {Object} data - Updated data
 * @returns {Promise<Object|null>}
 */
async function updateTag(id, data) {
  const db = getDb();
  const updates = [];
  const args = [];

  if (data.name !== undefined) {
    updates.push('name = ?');
    args.push(data.name.toLowerCase().trim());
  }

  if (data.color !== undefined) {
    updates.push('color = ?');
    args.push(data.color);
  }

  if (updates.length === 0) {
    return getTagById(id);
  }

  args.push(id);

  await db.execute({
    sql: `UPDATE tags SET ${updates.join(', ')} WHERE id = ?`,
    args: args,
  });

  return getTagById(id);
}

/**
 * Delete a tag
 * @param {number} id - Tag ID
 * @returns {Promise<boolean>}
 */
async function deleteTag(id) {
  const db = getDb();
  const tag = await getTagById(id);

  if (!tag) {
    return false;
  }

  await db.execute({
    sql: 'DELETE FROM tags WHERE id = ?',
    args: [id],
  });

  return true;
}

/**
 * Create multiple tags at once (for bulk operations)
 * @param {string[]} tagNames - Array of tag names
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>}
 */
async function createTagsIfNotExist(tagNames, userId = 'default_user') {
  const tags = [];

  for (const name of tagNames) {
    if (name && name.trim()) {
      const tag = await createTag({ name: name.trim(), userId });
      if (tag) tags.push(tag);
    }
  }

  return tags;
}

module.exports = {
  createTag,
  getTags,
  getTagById,
  getTagByName,
  updateTag,
  deleteTag,
  createTagsIfNotExist,
  TAG_COLORS,
};
