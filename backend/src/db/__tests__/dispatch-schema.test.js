const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function loadDbForFile(dbFile) {
  process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
  process.env.TURSO_AUTH_TOKEN = '';

  const modulePath = require.resolve('../index.js');
  delete require.cache[modulePath];

  const dbModule = require('../index.js');
  await dbModule.initDatabase();
  return dbModule.getDb();
}

async function getColumnNames(db, tableName) {
  const result = await db.execute(`PRAGMA table_info(${tableName})`);
  return (result.rows || []).map((row) => row.name);
}

test('dispatch schema adds work item, wakeup, review, decision, and run linkage tables', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-schema-'));
  const dbFile = path.join(tempDir, 'dispatch.db');
  const db = await loadDbForFile(dbFile);

  const tablesResult = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'aris_milestones',
        'aris_work_items',
        'aris_wakeups',
        'aris_reviews',
        'aris_decisions'
      )
  `);
  const tableNames = new Set((tablesResult.rows || []).map((row) => row.name));

  assert.deepEqual(tableNames, new Set([
    'aris_milestones',
    'aris_work_items',
    'aris_wakeups',
    'aris_reviews',
    'aris_decisions',
  ]));

  const runColumns = await getColumnNames(db, 'aris_runs');
  assert.ok(runColumns.includes('work_item_id'));
  assert.ok(runColumns.includes('completed_at'));

  const workItemColumns = await getColumnNames(db, 'aris_work_items');
  assert.ok(workItemColumns.includes('project_id'));
  assert.ok(workItemColumns.includes('status'));
  assert.ok(workItemColumns.includes('next_check_at'));
});

test('dispatch schema creates indexes for project, status, and schedule lookups', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dispatch-schema-index-'));
  const dbFile = path.join(tempDir, 'dispatch.db');
  const db = await loadDbForFile(dbFile);

  const indexesResult = await db.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name IN (
        'idx_aris_runs_project_status_updated',
        'idx_aris_work_items_project_status_updated',
        'idx_aris_wakeups_status_scheduled',
        'idx_aris_reviews_run_created'
      )
  `);
  const indexNames = new Set((indexesResult.rows || []).map((row) => row.name));

  assert.ok(indexNames.has('idx_aris_runs_project_status_updated'));
  assert.ok(indexNames.has('idx_aris_work_items_project_status_updated'));
  assert.ok(indexNames.has('idx_aris_wakeups_status_scheduled'));
  assert.ok(indexNames.has('idx_aris_reviews_run_created'));
});
