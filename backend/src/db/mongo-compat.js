/**
 * mongo-compat.js — SQL-to-MongoDB compatibility layer
 *
 * Translates `db.execute({ sql, args })` calls to MongoDB operations
 * so existing service files work without changes.
 *
 * Supports: SELECT, INSERT, INSERT OR REPLACE, UPDATE, DELETE,
 *           CREATE TABLE, CREATE INDEX, ALTER TABLE, COUNT(*), ORDER BY,
 *           LIMIT, OFFSET, LIKE, IN, IS NULL, IS NOT NULL, simple JOINs
 */

const { MongoClient } = require('mongodb');

let client = null;
let database = null;

// Auto-increment counters collection
const COUNTERS_COLLECTION = '_counters';

async function connect(uri, dbName) {
  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  console.log(`[MongoDB] Connected to ${dbName}`);
  return database;
}

function getDatabase() {
  if (!database) throw new Error('MongoDB not connected. Call connect() first.');
  return database;
}

// ─── Auto-increment helper ─────────────────────────────────────────────────
async function nextAutoId(tableName) {
  const counters = database.collection(COUNTERS_COLLECTION);
  const result = await counters.findOneAndUpdate(
    { _id: tableName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

// ─── SQL Parser ─────────────────────────────────────────────────────────────

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function substituteArgs(sql, args) {
  // Replace ? placeholders with actual values for parsing
  // We don't actually substitute — we track positions
  return { sql, args: args || [] };
}

// ─── Main execute function ──────────────────────────────────────────────────

async function execute(input) {
  const sql = typeof input === 'string' ? input : input.sql;
  const args = typeof input === 'string' ? [] : (input.args || []);
  const normalized = normalizeSql(sql);
  const upper = normalized.toUpperCase();

  try {
    // PRAGMA — return empty rows (MongoDB is schemaless, no column checks needed)
    if (upper.startsWith('PRAGMA')) {
      return { rows: [] };
    }

    // CREATE TRIGGER — no-op
    if (upper.startsWith('CREATE TRIGGER')) {
      return { rows: [], rowsAffected: 0 };
    }

    // DDL: CREATE TABLE, CREATE INDEX, ALTER TABLE — no-ops for MongoDB
    if (upper.startsWith('CREATE TABLE') || upper.startsWith('CREATE INDEX') || upper.startsWith('ALTER TABLE')) {
      // For CREATE TABLE, ensure collection exists
      if (upper.startsWith('CREATE TABLE')) {
        const tableMatch = normalized.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(\w+)/i);
        if (tableMatch) {
          const name = tableMatch[1];
          const collections = await database.listCollections({ name }).toArray();
          if (collections.length === 0) {
            await database.createCollection(name);
          }
        }
      }
      // For CREATE INDEX, create MongoDB index
      if (upper.startsWith('CREATE INDEX') || upper.startsWith('CREATE UNIQUE INDEX')) {
        await handleCreateIndex(normalized);
      }
      return { rows: [], rowsAffected: 0 };
    }

    // DML
    if (upper.startsWith('SELECT')) return handleSelect(normalized, args);
    if (upper.startsWith('INSERT OR REPLACE') || upper.startsWith('INSERT OR IGNORE')) return handleUpsert(normalized, args);
    if (upper.startsWith('INSERT')) return handleInsert(normalized, args);
    if (upper.startsWith('UPDATE')) return handleUpdate(normalized, args);
    if (upper.startsWith('DELETE')) return handleDelete(normalized, args);

    // Fallback — log and return empty
    console.warn('[MongoDB-compat] Unhandled SQL:', normalized.substring(0, 100));
    return { rows: [], rowsAffected: 0 };
  } catch (error) {
    console.error('[MongoDB-compat] Error executing:', normalized.substring(0, 120));
    console.error('[MongoDB-compat]', error.message);
    throw error;
  }
}

// ─── CREATE INDEX ───────────────────────────────────────────────────────────

async function handleCreateIndex(sql) {
  // CREATE [UNIQUE] INDEX [IF NOT EXISTS] idx_name ON table(col1, col2 [DESC])
  const match = sql.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF NOT EXISTS\s+)?(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/i);
  if (!match) return;
  const [, indexName, tableName, colsStr] = match;
  const isUnique = /UNIQUE/i.test(sql);
  const cols = colsStr.split(',').map(c => c.trim());
  const indexSpec = {};
  for (const col of cols) {
    const parts = col.split(/\s+/);
    const colName = parts[0];
    const dir = parts[1]?.toUpperCase() === 'DESC' ? -1 : 1;
    indexSpec[colName] = dir;
  }
  try {
    await database.collection(tableName).createIndex(indexSpec, { name: indexName, unique: isUnique, background: true });
  } catch (e) {
    // Index might already exist with different options
    if (!e.message.includes('already exists')) throw e;
  }
}

// ─── SELECT ─────────────────────────────────────────────────────────────────

async function handleSelect(sql, args) {
  // Check for JOIN
  if (/\bJOIN\b/i.test(sql)) {
    return handleSelectWithJoin(sql, args);
  }

  // Parse: SELECT columns FROM table [WHERE ...] [ORDER BY ...] [LIMIT ...] [OFFSET ...]
  const fromMatch = sql.match(/FROM\s+(\w+)/i);
  if (!fromMatch) return { rows: [] };
  const tableName = fromMatch[1];
  const collection = database.collection(tableName);

  // Parse WHERE
  const { filter, remainingArgs } = parseWhere(sql, args);

  // Parse ORDER BY
  const sort = parseOrderBy(sql);

  // Parse LIMIT and OFFSET
  const limitMatch = sql.match(/LIMIT\s+(\d+|\?)/i);
  const offsetMatch = sql.match(/OFFSET\s+(\d+|\?)/i);
  let limit = 0;
  let skip = 0;

  if (limitMatch) {
    if (limitMatch[1] === '?') {
      limit = parseInt(remainingArgs.shift()) || 0;
    } else {
      limit = parseInt(limitMatch[1]) || 0;
    }
  }
  if (offsetMatch) {
    if (offsetMatch[1] === '?') {
      skip = parseInt(remainingArgs.shift()) || 0;
    } else {
      skip = parseInt(offsetMatch[1]) || 0;
    }
  }

  // Check for COUNT(*)
  const isCount = /SELECT\s+COUNT\s*\(\s*\*\s*\)/i.test(sql);
  if (isCount) {
    const count = await collection.countDocuments(filter);
    // Check for alias: COUNT(*) as name
    const aliasMatch = sql.match(/COUNT\s*\(\s*\*\s*\)\s+(?:as|AS)\s+(\w+)/i);
    const alias = aliasMatch ? aliasMatch[1] : 'count';
    return { rows: [{ [alias]: count }] };
  }

  // Parse selected columns
  const projection = parseSelectColumns(sql);

  let cursor = collection.find(filter);
  if (projection) cursor = cursor.project(projection);
  if (Object.keys(sort).length > 0) cursor = cursor.sort(sort);
  if (skip > 0) cursor = cursor.skip(skip);
  if (limit > 0) cursor = cursor.limit(limit);

  const rows = await cursor.toArray();

  // Map _id to id for compatibility
  return { rows: rows.map(mapRow) };
}

// ─── SELECT with JOIN ───────────────────────────────────────────────────────

async function handleSelectWithJoin(sql, args) {
  // Simple approach: parse the main table and joined tables, do separate queries
  // This handles the common pattern: SELECT ... FROM A JOIN B ON A.x = B.y WHERE ...

  // Extract all tables: FROM table1 [alias1] [LEFT] JOIN table2 [alias2] ON ...
  const tables = [];
  const fromMatch = sql.match(/FROM\s+(\w+)(?:\s+(\w+))?\s/i);
  if (fromMatch) tables.push({ name: fromMatch[1], alias: fromMatch[2] || fromMatch[1] });

  const joinRegex = /(?:LEFT\s+)?JOIN\s+(\w+)(?:\s+(\w+))?\s+ON\s+(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/gi;
  let joinMatch;
  const joins = [];
  while ((joinMatch = joinRegex.exec(sql)) !== null) {
    const isLeft = sql.substring(joinMatch.index - 5, joinMatch.index).toUpperCase().includes('LEFT');
    tables.push({ name: joinMatch[1], alias: joinMatch[2] || joinMatch[1] });
    joins.push({
      table: joinMatch[1],
      alias: joinMatch[2] || joinMatch[1],
      leftAlias: joinMatch[3],
      leftCol: joinMatch[4],
      rightAlias: joinMatch[5],
      rightCol: joinMatch[6],
      isLeft,
    });
  }

  if (tables.length === 0) return { rows: [] };

  // Parse WHERE (applies to main table)
  const { filter } = parseWhere(sql, args);
  const sort = parseOrderBy(sql);
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  const limit = limitMatch ? parseInt(limitMatch[1]) : 0;

  // Fetch main table
  const mainTable = tables[0];
  let cursor = database.collection(mainTable.name).find(filter);
  if (Object.keys(sort).length > 0) cursor = cursor.sort(sort);
  if (limit > 0) cursor = cursor.limit(limit);
  const mainRows = await cursor.toArray();

  // For each join, fetch related docs and merge
  let result = mainRows.map(mapRow);
  for (const join of joins) {
    // Determine which column connects: e.g., A.document_id = B.id
    const isMainLeft = join.leftAlias === mainTable.alias || join.leftAlias === mainTable.name;
    const mainCol = isMainLeft ? join.leftCol : join.rightCol;
    const joinCol = isMainLeft ? join.rightCol : join.leftCol;

    // Get all IDs to look up
    const ids = [...new Set(result.map(r => r[mainCol]).filter(Boolean))];
    if (ids.length === 0) continue;

    const joinDocs = await database.collection(join.table)
      .find({ [joinCol]: { $in: ids } })
      .toArray();
    const joinMap = {};
    for (const doc of joinDocs) {
      const key = String(doc[joinCol] ?? doc._id);
      joinMap[key] = mapRow(doc);
    }

    // Merge
    result = result.map(row => {
      const joinDoc = joinMap[String(row[mainCol])] || {};
      return { ...joinDoc, ...row }; // main table fields take precedence
    }).filter(row => join.isLeft || joinMap[String(row[mainCol])]);
  }

  return { rows: result };
}

// ─── INSERT ─────────────────────────────────────────────────────────────────

async function handleInsert(sql, args) {
  const match = sql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!match) return { rows: [], rowsAffected: 0, lastInsertRowid: 0 };

  const tableName = match[1];
  const columns = match[2].split(',').map(c => c.trim());
  const placeholders = match[3].split(',').map(p => p.trim());

  const doc = {};
  let argIdx = 0;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (placeholders[i]?.trim() === '?') {
      doc[col] = args[argIdx++];
    } else {
      // Literal value: CURRENT_TIMESTAMP, numbers, strings
      const val = placeholders[i]?.trim();
      if (val?.toUpperCase() === 'CURRENT_TIMESTAMP') {
        doc[col] = new Date().toISOString();
      } else {
        doc[col] = val?.replace(/^'|'$/g, '');
      }
    }
  }

  // Auto-set timestamp defaults that SQLite would handle via DEFAULT CURRENT_TIMESTAMP
  const now = new Date().toISOString();
  if (doc.created_at === undefined) doc.created_at = now;
  if (doc.updated_at === undefined) doc.updated_at = now;

  // Handle auto-increment id
  const collection = database.collection(tableName);
  if (!doc.id && columns.includes('id') && doc.id === undefined) {
    // id column exists but value is null/undefined — auto-increment
  }

  // For tables with INTEGER PRIMARY KEY (like documents), generate auto-increment id
  if (doc.id === undefined || doc.id === null) {
    // Check if this table uses auto-increment (documents, tags, etc.)
    if (['documents', 'tags', 'processing_queue', 'processing_history',
         'code_analysis_queue', 'code_analysis_history', 'reading_history',
         'user_notes', 'ai_edit_queue', 'users', 'prompt_templates'].includes(tableName)) {
      doc.id = await nextAutoId(tableName);
    }
  }

  // Set _id to id for MongoDB
  if (doc.id !== undefined && doc.id !== null) {
    doc._id = doc.id;
  }

  try {
    const result = await collection.insertOne(doc);
    return { rows: [], rowsAffected: 1, lastInsertRowid: doc.id || result.insertedId };
  } catch (e) {
    if (e.code === 11000) {
      // Duplicate key — for INSERT (not upsert), just ignore or throw
      return { rows: [], rowsAffected: 0, lastInsertRowid: doc.id };
    }
    throw e;
  }
}

// ─── INSERT OR REPLACE / INSERT OR IGNORE ───────────────────────────────────

async function handleUpsert(sql, args) {
  const isIgnore = /INSERT\s+OR\s+IGNORE/i.test(sql);
  const cleanSql = sql.replace(/INSERT\s+OR\s+(?:REPLACE|IGNORE)/i, 'INSERT');
  const match = cleanSql.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (!match) return { rows: [], rowsAffected: 0 };

  const tableName = match[1];
  const columns = match[2].split(',').map(c => c.trim());
  const placeholders = match[3].split(',').map(p => p.trim());

  const doc = {};
  let argIdx = 0;
  for (let i = 0; i < columns.length; i++) {
    if (placeholders[i]?.trim() === '?') {
      doc[columns[i]] = args[argIdx++];
    } else {
      const val = placeholders[i]?.trim();
      if (val?.toUpperCase() === 'CURRENT_TIMESTAMP') {
        doc[columns[i]] = new Date().toISOString();
      } else {
        doc[columns[i]] = val?.replace(/^'|'$/g, '');
      }
    }
  }

  const collection = database.collection(tableName);

  // Determine the primary key field
  const pkField = doc.id !== undefined ? 'id' : columns[0];
  const pkValue = doc[pkField];

  if (doc.id !== undefined) doc._id = doc.id;

  if (isIgnore) {
    try {
      await collection.insertOne(doc);
      return { rows: [], rowsAffected: 1 };
    } catch (e) {
      if (e.code === 11000) return { rows: [], rowsAffected: 0 };
      throw e;
    }
  }

  // REPLACE: upsert
  const filter = doc._id !== undefined ? { _id: doc._id } : { [pkField]: pkValue };
  await collection.replaceOne(filter, doc, { upsert: true });
  return { rows: [], rowsAffected: 1 };
}

// ─── UPDATE ─────────────────────────────────────────────────────────────────

async function handleUpdate(sql, args) {
  // UPDATE table SET col1 = ?, col2 = ? WHERE ...
  const tableMatch = sql.match(/UPDATE\s+(\w+)\s+SET/i);
  if (!tableMatch) return { rows: [], rowsAffected: 0 };
  const tableName = tableMatch[1];

  // Extract SET clause
  const setMatch = sql.match(/SET\s+(.+?)(?:\s+WHERE\s+|$)/i);
  if (!setMatch) return { rows: [], rowsAffected: 0 };

  const setClause = setMatch[1];
  const setParts = splitSetClause(setClause);
  const update = {};
  let argIdx = 0;

  for (const part of setParts) {
    const [col, valExpr] = part.split('=').map(s => s.trim());
    if (valExpr === '?') {
      update[col] = args[argIdx++];
    } else if (valExpr?.toUpperCase() === 'CURRENT_TIMESTAMP') {
      update[col] = new Date().toISOString();
    } else if (valExpr) {
      // Handle expressions like col = col + 1
      if (/\w+\s*[+\-]\s*\d+/.test(valExpr)) {
        // Can't easily do this with $set, use $inc
        const incMatch = valExpr.match(/(\w+)\s*\+\s*(\d+)/);
        if (incMatch) {
          // We'll handle $inc separately
          update[col] = { $inc: parseInt(incMatch[2]) };
          continue;
        }
      }
      update[col] = valExpr.replace(/^'|'$/g, '');
    }
  }

  // Parse WHERE
  const { filter } = parseWhere(sql, args, argIdx);

  const $set = {};
  const $inc = {};
  for (const [k, v] of Object.entries(update)) {
    if (v && typeof v === 'object' && v.$inc) {
      $inc[k] = v.$inc;
    } else {
      $set[k] = v;
    }
  }

  const updateOp = {};
  if (Object.keys($set).length > 0) updateOp.$set = $set;
  if (Object.keys($inc).length > 0) updateOp.$inc = $inc;

  if (Object.keys(updateOp).length === 0) return { rows: [], rowsAffected: 0 };

  const collection = database.collection(tableName);
  const result = await collection.updateMany(filter, updateOp);
  return { rows: [], rowsAffected: result.modifiedCount };
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

async function handleDelete(sql, args) {
  const tableMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
  if (!tableMatch) return { rows: [], rowsAffected: 0 };
  const tableName = tableMatch[1];

  const { filter } = parseWhere(sql, args);
  const collection = database.collection(tableName);
  const result = await collection.deleteMany(filter);
  return { rows: [], rowsAffected: result.deletedCount };
}

// ─── Parse helpers ──────────────────────────────────────────────────────────

function parseWhere(sql, args, startArgIdx = 0) {
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+GROUP\s+BY|\s+LIMIT|\s+OFFSET|\s*$)/i);
  if (!whereMatch) return { filter: {}, remainingArgs: args.slice(startArgIdx) };

  let whereClause = whereMatch[1].trim();
  let argIdx = startArgIdx;

  // Count ? in SET clause (for UPDATE) to offset arg index
  const setMatch = sql.match(/SET\s+(.+?)\s+WHERE/i);
  if (setMatch) {
    const setQmarks = (setMatch[1].match(/\?/g) || []).length;
    argIdx = setQmarks;
  }

  const filter = parseConditions(whereClause, args, argIdx);
  const usedArgs = countPlaceholders(whereClause);
  return { filter, remainingArgs: args.slice(argIdx + usedArgs) };
}

function parseConditions(clause, args, startIdx) {
  // Split by AND/OR (simple — doesn't handle nested parens well)
  // Handle OR by converting to $or
  const orParts = splitByKeyword(clause, 'OR');
  if (orParts.length > 1) {
    const conditions = orParts.map(part => parseConditions(part.trim(), args, startIdx));
    // Adjust startIdx for each OR part
    return { $or: conditions };
  }

  const andParts = splitByKeyword(clause, 'AND');
  const filter = {};
  let argIdx = startIdx;

  for (const part of andParts) {
    const trimmed = part.trim()
      .replace(/^\(+/, '').replace(/\)+$/, ''); // strip outer parens

    if (!trimmed) continue;

    // col IN (?, ?, ?)
    const inMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+(?:NOT\s+)?IN\s*\(([^)]+)\)/i);
    if (inMatch) {
      const col = resolveCol(inMatch[1]);
      const isNot = /NOT\s+IN/i.test(trimmed);
      const placeholders = inMatch[2].split(',').map(p => p.trim());
      const values = placeholders.map(p => {
        if (p === '?') return args[argIdx++];
        return p.replace(/^'|'$/g, '');
      });
      filter[col] = isNot ? { $nin: values } : { $in: values };
      continue;
    }

    // col IS NULL / IS NOT NULL
    const nullMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+IS\s+(NOT\s+)?NULL/i);
    if (nullMatch) {
      const col = resolveCol(nullMatch[1]);
      filter[col] = nullMatch[2] ? { $ne: null } : null;
      continue;
    }

    // col LIKE ?
    const likeMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+LIKE\s+\?/i);
    if (likeMatch) {
      const col = resolveCol(likeMatch[1]);
      const pattern = String(args[argIdx++] || '');
      // Convert SQL LIKE to regex: % -> .*, _ -> .
      const regex = pattern.replace(/%/g, '.*').replace(/_/g, '.');
      filter[col] = { $regex: new RegExp(regex, 'i') };
      continue;
    }

    // col GLOB ?
    const globMatch = trimmed.match(/(\w+(?:\.\w+)?)\s+GLOB\s+\?/i);
    if (globMatch) {
      const col = resolveCol(globMatch[1]);
      const pattern = String(args[argIdx++] || '');
      filter[col] = { $regex: new RegExp(pattern.replace(/\*/g, '.*'), 'i') };
      continue;
    }

    // col >= ? / <= ? / > ? / < ? / != ? / <> ?
    const cmpMatch = trimmed.match(/(\w+(?:\.\w+)?)\s*(>=|<=|!=|<>|>|<|=)\s*\??/i);
    if (cmpMatch) {
      const col = resolveCol(cmpMatch[1]);
      const op = cmpMatch[2];
      let val;
      if (trimmed.includes('?')) {
        val = args[argIdx++];
      } else {
        const raw = trimmed.split(op).slice(1).join(op).trim().replace(/^'|'$/g, '');
        // Coerce numeric literals: "0" -> 0, "1" -> 1, etc.
        val = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      }

      switch (op) {
        case '=': filter[col] = val; break;
        case '!=': case '<>': filter[col] = { $ne: val }; break;
        case '>': filter[col] = { ...(filter[col] || {}), $gt: val }; break;
        case '>=': filter[col] = { ...(filter[col] || {}), $gte: val }; break;
        case '<': filter[col] = { ...(filter[col] || {}), $lt: val }; break;
        case '<=': filter[col] = { ...(filter[col] || {}), $lte: val }; break;
      }
      continue;
    }
  }

  // Remap 'id' to '_id' for primary key queries, coercing pure-numeric string IDs to numbers
  if (filter.id !== undefined && typeof filter.id !== 'object') {
    let mappedId = filter.id;
    if (typeof filter.id === 'string' && /^\d+$/.test(filter.id)) {
      mappedId = parseInt(filter.id, 10);
    }
    filter._id = mappedId;
    delete filter.id;
  }

  return filter;
}

function parseOrderBy(sql) {
  const match = sql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|\s*$)/i);
  if (!match) return {};
  const sort = {};
  const parts = match[1].split(',');
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    let col = tokens[0];
    // Remove table alias prefix and function wrappers
    col = col.replace(/^\w+\./, '');
    col = col.replace(/^(?:datetime|COALESCE)\s*\(/i, '').replace(/\)$/, '');
    if (col.includes('(')) continue; // skip complex expressions
    const dir = tokens[1]?.toUpperCase() === 'DESC' ? -1 : 1;
    sort[col] = dir;
  }
  return sort;
}

function parseSelectColumns(sql) {
  const match = sql.match(/SELECT\s+(.+?)\s+FROM/i);
  if (!match) return null;
  const colStr = match[1].trim();
  if (colStr === '*') return null;
  // Don't project if there are functions or aliases
  if (/\(|\bAS\b/i.test(colStr)) return null;
  // Simple column list
  const cols = colStr.split(',').map(c => c.trim().replace(/^\w+\./, ''));
  if (cols.some(c => c === '*')) return null;
  const projection = {};
  for (const col of cols) projection[col] = 1;
  return projection;
}

function resolveCol(col) {
  // Remove table alias prefix: t.column -> column
  return col.replace(/^\w+\./, '');
}

function splitSetClause(setClause) {
  // Split by comma, but not inside parentheses
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of setClause) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitByKeyword(clause, keyword) {
  // Split clause by keyword (AND/OR) respecting parentheses
  const regex = new RegExp(`\\s+${keyword}\\s+`, 'gi');
  const parts = [];
  let lastIndex = 0;
  let depth = 0;
  for (let i = 0; i < clause.length; i++) {
    if (clause[i] === '(') depth++;
    if (clause[i] === ')') depth--;
    if (depth === 0) {
      const remaining = clause.substring(i);
      const m = remaining.match(regex);
      if (m && remaining.indexOf(m[0]) === 0) {
        parts.push(clause.substring(lastIndex, i));
        lastIndex = i + m[0].length;
        i = lastIndex - 1;
      }
    }
  }
  parts.push(clause.substring(lastIndex));
  return parts.filter(Boolean);
}

function countPlaceholders(str) {
  return (str.match(/\?/g) || []).length;
}

function mapRow(doc) {
  if (!doc) return doc;
  const row = { ...doc };
  // Map _id back to id
  if (row._id !== undefined && row.id === undefined) {
    row.id = row._id;
  }
  delete row._id;
  return row;
}

module.exports = {
  connect,
  getDatabase,
  execute,
  nextAutoId,
};
