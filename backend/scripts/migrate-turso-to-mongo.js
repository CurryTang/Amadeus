#!/usr/bin/env node
/**
 * Migrate all data from Turso (libSQL) to MongoDB Atlas
 * Run: node scripts/migrate-turso-to-mongo.js
 */

const { createClient } = require('@libsql/client');
const { MongoClient } = require('mongodb');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const MONGO_URI = process.env.MONGODB_URI;
const MONGO_DB = process.env.MONGO_DB_NAME || 'autoresearcher';

if (!TURSO_URL || !TURSO_TOKEN || !MONGO_URI) {
  console.error('Required env vars: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, MONGODB_URI');
  process.exit(1);
}

// Tables with INTEGER PRIMARY KEY AUTOINCREMENT (need _id = id)
const AUTO_ID_TABLES = new Set([
  'documents', 'tags', 'processing_queue', 'processing_history',
  'code_analysis_queue', 'code_analysis_history', 'reading_history',
  'user_notes', 'ai_edit_queue', 'users', 'prompt_templates',
]);

// All tables to migrate
const TABLES = [
  'documents', 'tags', 'users', 'ssh_servers', 'prompt_templates',
  'processing_queue', 'processing_history',
  'code_analysis_queue', 'code_analysis_history',
  'reading_history', 'user_notes', 'ai_edit_queue',
  'aris_projects', 'aris_project_targets', 'aris_runs', 'aris_run_actions',
  'aris_milestones', 'aris_work_items', 'aris_wakeups', 'aris_reviews', 'aris_decisions',
  'aris_plan_nodes',
  'tracker_sources', 'tracker_seen_papers', 'tracker_archived_posts',
  'tracker_feed_cache', 'tracker_item_events', 'tracker_sources_audit',
  'knowledge_groups', 'knowledge_group_documents', 'knowledge_assets',
  'knowledge_group_assets', 'knowledge_asset_versions',
  'agent_session_cache', 'agent_sessions',
];

async function main() {
  console.log('=== Turso → MongoDB Migration ===\n');

  // Connect to both databases
  const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });
  const mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  const mongoDB = mongoClient.db(MONGO_DB);

  console.log('Connected to Turso and MongoDB\n');

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const table of TABLES) {
    try {
      // Check if table exists in Turso
      const countResult = await turso.execute(`SELECT COUNT(*) as c FROM ${table}`);
      const count = countResult.rows[0].c;

      if (count === 0) {
        console.log(`  ${table}: 0 rows (skip)`);
        totalSkipped++;
        continue;
      }

      // Fetch all rows
      const result = await turso.execute(`SELECT * FROM ${table}`);
      const rows = result.rows;

      // Prepare documents for MongoDB
      const docs = rows.map(row => {
        const doc = { ...row };

        // Set _id based on table type
        if (AUTO_ID_TABLES.has(table) && doc.id !== undefined) {
          doc._id = doc.id;
        } else if (doc.id !== undefined) {
          doc._id = doc.id;
        }

        return doc;
      });

      // Drop existing collection and insert
      const collection = mongoDB.collection(table);
      await collection.deleteMany({});

      // Insert in batches of 100
      for (let i = 0; i < docs.length; i += 100) {
        const batch = docs.slice(i, i + 100);
        try {
          await collection.insertMany(batch, { ordered: false });
        } catch (e) {
          // Handle duplicate key errors gracefully
          if (e.code === 11000) {
            console.log(`    (some duplicates in ${table}, inserting individually)`);
            for (const doc of batch) {
              try { await collection.replaceOne({ _id: doc._id }, doc, { upsert: true }); } catch (_) {}
            }
          } else {
            throw e;
          }
        }
      }

      // Update auto-increment counter
      if (AUTO_ID_TABLES.has(table)) {
        const maxId = Math.max(...docs.map(d => typeof d.id === 'number' ? d.id : 0));
        if (maxId > 0) {
          await mongoDB.collection('_counters').replaceOne(
            { _id: table },
            { _id: table, seq: maxId },
            { upsert: true }
          );
        }
      }

      console.log(`  ${table}: ${docs.length} rows migrated ✓`);
      totalMigrated += docs.length;
    } catch (e) {
      if (e.message?.includes('no such table')) {
        console.log(`  ${table}: table not found in Turso (skip)`);
        totalSkipped++;
      } else {
        console.error(`  ${table}: ERROR - ${e.message}`);
      }
    }
  }

  console.log(`\n=== Migration Complete ===`);
  console.log(`Total rows migrated: ${totalMigrated}`);
  console.log(`Tables skipped: ${totalSkipped}`);

  await mongoClient.close();
  process.exit(0);
}

main().catch(e => {
  console.error('Migration failed:', e);
  process.exit(1);
});
