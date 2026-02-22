const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const config = require('../config');

let db = null;

async function initDatabase() {
  db = createClient({
    url: config.turso.url,
    authToken: config.turso.authToken,
  });

  // Create documents table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      type TEXT DEFAULT 'other' CHECK(type IN ('paper', 'book', 'blog', 'other')),
      original_url TEXT,
      s3_key TEXT NOT NULL,
      s3_url TEXT,
      file_size INTEGER,
      mime_type TEXT DEFAULT 'application/pdf',
      tags TEXT DEFAULT '[]',
      notes TEXT,
      user_id TEXT DEFAULT 'default_user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create tags table for managing available tags
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6b7280',
      user_id TEXT DEFAULT 'default_user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create index for faster queries
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tags_user_id ON tags(user_id)
  `);

  // Add processing columns to documents table (migration-safe)
  const processingColumns = [
    { name: 'processing_status', definition: "TEXT DEFAULT 'idle'" },
    { name: 'notes_s3_key', definition: 'TEXT' },
    { name: 'page_count', definition: 'INTEGER' },
    { name: 'processing_error', definition: 'TEXT' },
    { name: 'processing_started_at', definition: 'DATETIME' },
    { name: 'processing_completed_at', definition: 'DATETIME' },
    { name: 'is_read', definition: 'INTEGER DEFAULT 0' },
    // Auto-reader mode columns
    { name: 'reader_mode', definition: "TEXT DEFAULT 'auto_reader_v2'" },
    { name: 'code_notes_s3_key', definition: 'TEXT' },
    { name: 'has_code', definition: 'INTEGER DEFAULT 0' },
    { name: 'code_url', definition: 'TEXT' },
    // Analysis provider column (gemini-cli, google-api, claude-code)
    { name: 'analysis_provider', definition: "TEXT DEFAULT 'gemini-cli'" },
  ];

  for (const col of processingColumns) {
    try {
      await db.execute(`ALTER TABLE documents ADD COLUMN ${col.name} ${col.definition}`);
    } catch (err) {
      // Column already exists, ignore
    }
  }

  // Create processing queue table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS processing_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL UNIQUE,
      priority INTEGER DEFAULT 0,
      retry_count INTEGER DEFAULT 0,
      max_retries INTEGER DEFAULT 3,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_processing_queue_scheduled ON processing_queue(scheduled_at)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_processing_queue_priority ON processing_queue(priority DESC, scheduled_at ASC)
  `);

  // Create prompt templates table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT,
      user_prompt TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      user_id TEXT DEFAULT 'default_user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default prompt template if not exists
  const existingTemplate = await db.execute(`
    SELECT id FROM prompt_templates WHERE name = 'Vanilla Summary' AND user_id = 'default_user'
  `);

  if (existingTemplate.rows.length === 0) {
    await db.execute({
      sql: `INSERT INTO prompt_templates (name, description, system_prompt, user_prompt, is_default, user_id)
            VALUES (?, ?, ?, ?, 1, 'default_user')`,
      args: [
        'Vanilla Summary',
        'Basic paper summary with key points',
        'You are an expert academic research assistant. Your task is to summarize research papers clearly and concisely.',
        `Please summarize the following research paper. Include:

## Summary
A brief 2-3 sentence overview of the paper.

## Key Contributions
- List the main contributions (3-5 bullet points)

## Methodology
Brief description of the methods used.

## Results
Key findings and results.

## Limitations
Any limitations mentioned or observed.

## Relevance
Why this paper might be important for researchers.`
      ]
    });
  }

  // Create processing history table for rate limiting
  await db.execute(`
    CREATE TABLE IF NOT EXISTS processing_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      completed_at DATETIME,
      duration_ms INTEGER,
      model_used TEXT,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_processing_history_started ON processing_history(started_at DESC)
  `);

  // Create code analysis queue table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS code_analysis_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL UNIQUE,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      priority INTEGER DEFAULT 0,
      error_message TEXT,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_code_analysis_queue_status ON code_analysis_queue(status, scheduled_at)
  `);

  // Create code analysis history table for rate limiting (3 per 6 hours)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS code_analysis_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      status TEXT NOT NULL,
      started_at DATETIME NOT NULL,
      completed_at DATETIME,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_code_analysis_history_started ON code_analysis_history(started_at DESC)
  `);

  // Add code_analysis_status column to documents (migration-safe)
  try {
    await db.execute(`ALTER TABLE documents ADD COLUMN code_analysis_status TEXT DEFAULT NULL`);
  } catch (err) {
    // Column already exists, ignore
  }

  // Create reading history table to track reads with name and date
  await db.execute(`
    CREATE TABLE IF NOT EXISTS reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      reader_name TEXT NOT NULL,
      reader_mode TEXT,
      notes TEXT,
      read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_reading_history_document ON reading_history(document_id)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_reading_history_date ON reading_history(read_at DESC)
  `);

  // Create user_notes table for personal annotations
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      title TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_user_notes_document ON user_notes(document_id)
  `);

  // Create AI edit queue table for intelligent note editing
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ai_edit_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('paper', 'code')),
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'queued' CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_ai_edit_queue_status ON ai_edit_queue(status, created_at)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_ai_edit_queue_document ON ai_edit_queue(document_id)
  `);

  // Create users table for username/password authentication
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed users from environment variables (idempotent — INSERT OR IGNORE)
  const userSeeds = [
    { username: 'czk', password: process.env.CZK_PASSWORD },
    { username: 'lyf', password: process.env.LYF_PASSWORD },
  ];
  for (const { username, password } of userSeeds) {
    if (!password) continue; // skip if env var not set
    const hash = await bcrypt.hash(password, 12);
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (username, password_hash) VALUES (?, ?)`,
      args: [username, hash],
    });
  }

  // Migrate existing default_user data to czk (idempotent)
  await db.execute(`UPDATE documents SET user_id = 'czk' WHERE user_id = 'default_user'`);
  await db.execute(`UPDATE tags SET user_id = 'czk' WHERE user_id = 'default_user'`);
  await db.execute(`UPDATE prompt_templates SET user_id = 'czk' WHERE user_id = 'default_user'`);

  // Create SSH servers table for remote file sending
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ssh_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      user TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      ssh_key_path TEXT DEFAULT '~/.ssh/id_rsa',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create tracker sources table for paper tracking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('hf', 'twitter', 'scholar', 'alphaxiv')),
      name TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add 'alphaxiv' to tracker_sources type CHECK constraint
  // (existing DBs have the old CHECK without alphaxiv — recreate the table)
  try {
    await db.execute({
      sql: `INSERT INTO tracker_sources (type, name) VALUES ('alphaxiv', '__migration_test__')`,
      args: [],
    });
    await db.execute({ sql: `DELETE FROM tracker_sources WHERE name = '__migration_test__'`, args: [] });
  } catch (migErr) {
    if (migErr.message?.toLowerCase().includes('check') || migErr.message?.toLowerCase().includes('constraint')) {
      console.log('[Migration] Updating tracker_sources to add alphaxiv type...');
      await db.execute(`ALTER TABLE tracker_sources RENAME TO tracker_sources_bak`);
      await db.execute(`
        CREATE TABLE tracker_sources (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK(type IN ('hf', 'twitter', 'scholar', 'alphaxiv')),
          name TEXT NOT NULL,
          config TEXT DEFAULT '{}',
          enabled INTEGER DEFAULT 1,
          last_checked_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await db.execute(`INSERT INTO tracker_sources SELECT * FROM tracker_sources_bak`);
      await db.execute(`DROP TABLE tracker_sources_bak`);
      console.log('[Migration] tracker_sources updated');
    }
  }

  // Create tracker seen papers table for deduplication
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_seen_papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      arxiv_id TEXT UNIQUE,
      source_type TEXT,
      seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_seen_arxiv ON tracker_seen_papers(arxiv_id)
  `);

  // Archive crawled Twitter/X posts so we can avoid re-processing the same post URLs
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_archived_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      source_type TEXT,
      source_name TEXT,
      influencer_handle TEXT,
      post_url TEXT UNIQUE,
      post_text TEXT,
      posted_at TEXT,
      paper_links TEXT DEFAULT '[]',
      all_links TEXT DEFAULT '[]',
      arxiv_ids TEXT DEFAULT '[]',
      crawled_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_archived_source_crawled
    ON tracker_archived_posts(source_id, crawled_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_archived_handle_crawled
    ON tracker_archived_posts(influencer_handle, crawled_at DESC)
  `);

  // Migration: reset stuck queued/pending papers to idle (on-demand generation)
  const stuck = await db.execute(`
    SELECT COUNT(*) as count FROM documents WHERE processing_status IN ('queued', 'pending')
  `);
  if (stuck.rows[0].count > 0) {
    await db.execute(`UPDATE documents SET processing_status = 'idle' WHERE processing_status IN ('queued', 'pending')`);
    await db.execute(`DELETE FROM processing_queue`);
    console.log(`[Migration] Reset ${stuck.rows[0].count} stuck queued/pending papers to idle`);
  }

  console.log('Database initialized');
  return db;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

module.exports = {
  initDatabase,
  getDb,
};
