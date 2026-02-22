#!/usr/bin/env node
/**
 * Cleanup script to remove all documents except specified ones
 * Usage: node scripts/cleanup-documents.js
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');

const KEEP_TITLE = 'RePo: Language Models with Context Re-Positioning';

async function main() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log('Connecting to database...');

  // Find the document to keep
  const keepResult = await db.execute({
    sql: 'SELECT id, title FROM documents WHERE title LIKE ?',
    args: [`%${KEEP_TITLE}%`],
  });

  if (keepResult.rows.length === 0) {
    console.error(`Document not found: ${KEEP_TITLE}`);
    console.log('\nAvailable documents:');
    const allDocs = await db.execute('SELECT id, title FROM documents');
    allDocs.rows.forEach(doc => console.log(`  [${doc.id}] ${doc.title}`));
    process.exit(1);
  }

  const keepId = keepResult.rows[0].id;
  console.log(`Keeping document [${keepId}]: ${keepResult.rows[0].title}`);

  // Count documents to delete
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM documents WHERE id != ?',
    args: [keepId],
  });
  const deleteCount = countResult.rows[0].count;
  console.log(`Will delete ${deleteCount} documents`);

  if (deleteCount === 0) {
    console.log('Nothing to delete.');
    process.exit(0);
  }

  // Helper to safely delete from table (ignores if table doesn't exist)
  async function safeDelete(table) {
    try {
      console.log(`Deleting from ${table}...`);
      await db.execute({
        sql: `DELETE FROM ${table} WHERE document_id != ?`,
        args: [keepId],
      });
    } catch (e) {
      if (e.message.includes('no such table')) {
        console.log(`  (table ${table} does not exist, skipping)`);
      } else {
        throw e;
      }
    }
  }

  // Delete from related tables first (foreign key constraints)
  await safeDelete('processing_queue');
  await safeDelete('processing_history');
  await safeDelete('code_analysis_queue');
  await safeDelete('code_analysis_history');
  await safeDelete('document_tags');

  // Delete documents
  console.log('Deleting documents...');
  const deleteResult = await db.execute({
    sql: 'DELETE FROM documents WHERE id != ?',
    args: [keepId],
  });

  console.log(`\nDone! Deleted ${deleteResult.rowsAffected} documents.`);
  console.log(`Remaining: 1 document (${KEEP_TITLE})`);
}

main().catch(console.error);
