#!/usr/bin/env node
/**
 * Script to clear all tags from the database
 * Usage: node scripts/clear-tags.js
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');

async function main() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log('Connecting to database...');

  // Check existing tags
  const existingTags = await db.execute('SELECT * FROM tags');
  console.log(`Found ${existingTags.rows.length} tags`);

  if (existingTags.rows.length === 0) {
    console.log('No tags to delete.');
    process.exit(0);
  }

  // Show what will be deleted
  existingTags.rows.forEach(tag => {
    console.log(`  - [${tag.id}] ${tag.name}`);
  });

  // Clear document_tags junction table first
  try {
    const docTagsResult = await db.execute('DELETE FROM document_tags');
    console.log(`Deleted ${docTagsResult.rowsAffected} document-tag associations`);
  } catch (e) {
    if (e.message.includes('no such table')) {
      console.log('  (document_tags table does not exist, skipping)');
    } else {
      throw e;
    }
  }

  // Clear tags table
  const tagsResult = await db.execute('DELETE FROM tags');
  console.log(`Deleted ${tagsResult.rowsAffected} tags`);

  console.log('\nDone! All tags have been cleared.');
}

main().catch(console.error);
