const bcrypt = require('bcryptjs');
const config = require('../config');

let db = null;

async function initDatabase() {
  const { createClient } = require('@libsql/client');
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
    // Analysis model override (null = use provider default)
    { name: 'analysis_model', definition: 'TEXT DEFAULT NULL' },
    // Extended thinking budget in tokens (0 = disabled)
    { name: 'thinking_budget', definition: 'INTEGER DEFAULT 0' },
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

  // Migration: add refinement_rounds_json if not present
  try {
    await db.execute(`ALTER TABLE processing_queue ADD COLUMN refinement_rounds_json TEXT DEFAULT NULL`);
  } catch (_) { /* column already exists */ }

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
      tracker_onboarding_seen INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add tracker onboarding flag and mark existing users as seen.
  try {
    const userCols = await db.execute(`PRAGMA table_info(users)`);
    const hasOnboardingSeen = (userCols.rows || []).some((c) => c.name === 'tracker_onboarding_seen');
    if (!hasOnboardingSeen) {
      await db.execute(`ALTER TABLE users ADD COLUMN tracker_onboarding_seen INTEGER DEFAULT 0`);
      await db.execute(`UPDATE users SET tracker_onboarding_seen = 1`);
      console.log('[Migration] Added users.tracker_onboarding_seen and marked existing users as seen');
    }
  } catch (err) {
    console.warn('[Migration] Could not verify/add users.tracker_onboarding_seen:', err.message);
  }

  // Seed users from environment variables (idempotent — INSERT OR IGNORE)
  const userSeeds = [
    { username: 'czk', password: process.env.CZK_PASSWORD },
    { username: 'lyf', password: process.env.LYF_PASSWORD },
  ];
  for (const { username, password } of userSeeds) {
    if (!password) continue; // skip if env var not set
    const hash = await bcrypt.hash(password, 12);
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (username, password_hash, tracker_onboarding_seen) VALUES (?, ?, 1)`,
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
      proxy_jump TEXT DEFAULT '',
      shared_fs_enabled INTEGER DEFAULT 0,
      shared_fs_group TEXT DEFAULT '',
      shared_fs_local_path TEXT DEFAULT '',
      shared_fs_remote_path TEXT DEFAULT '',
      shared_fs_peers TEXT DEFAULT '[]',
      shared_fs_verified_peers TEXT DEFAULT '[]',
      shared_fs_verified INTEGER DEFAULT 0,
      shared_fs_last_checked_at DATETIME,
      shared_fs_last_status TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS aris_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      workflow_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      runner_server_id INTEGER,
      runner_host TEXT,
      downstream_server_id INTEGER,
      downstream_server_name TEXT DEFAULT '',
      remote_workspace_path TEXT NOT NULL,
      dataset_root TEXT DEFAULT '',
      requires_upload INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      active_phase TEXT NOT NULL,
      latest_score REAL,
      latest_verdict TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      started_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      remote_pid INTEGER,
      log_path TEXT DEFAULT '',
      run_directory TEXT DEFAULT '',
      retry_of_run_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: add proxy_jump column for SSH ProxyJump support.
  try {
    const sshCols = await db.execute(`PRAGMA table_info(ssh_servers)`);
    const hasProxyJump = (sshCols.rows || []).some((c) => c.name === 'proxy_jump');
    if (!hasProxyJump) {
      await db.execute(`ALTER TABLE ssh_servers ADD COLUMN proxy_jump TEXT DEFAULT ''`);
      console.log('[Migration] Added ssh_servers.proxy_jump');
    }
  } catch (err) {
    console.warn('[Migration] Could not verify/add ssh_servers.proxy_jump:', err.message);
  }

  // Migration: add shared filesystem config/status columns for cross-server execution.
  try {
    const sshCols = await db.execute(`PRAGMA table_info(ssh_servers)`);
    const colNames = new Set((sshCols.rows || []).map((c) => c.name));
    const sharedFsColumns = [
      { name: 'shared_fs_enabled', definition: 'INTEGER DEFAULT 0' },
      { name: 'shared_fs_group', definition: "TEXT DEFAULT ''" },
      { name: 'shared_fs_local_path', definition: "TEXT DEFAULT ''" },
      { name: 'shared_fs_remote_path', definition: "TEXT DEFAULT ''" },
      { name: 'shared_fs_peers', definition: "TEXT DEFAULT '[]'" },
      { name: 'shared_fs_verified_peers', definition: "TEXT DEFAULT '[]'" },
      { name: 'shared_fs_verified', definition: 'INTEGER DEFAULT 0' },
      { name: 'shared_fs_last_checked_at', definition: 'DATETIME' },
      { name: 'shared_fs_last_status', definition: "TEXT DEFAULT ''" },
    ];
    for (const col of sharedFsColumns) {
      if (colNames.has(col.name)) continue;
      // eslint-disable-next-line no-await-in-loop
      await db.execute(`ALTER TABLE ssh_servers ADD COLUMN ${col.name} ${col.definition}`);
      console.log(`[Migration] Added ssh_servers.${col.name}`);
    }
  } catch (err) {
    console.warn('[Migration] Could not verify/add ssh_servers shared_fs columns:', err.message);
  }

  // Create tracker sources table for paper tracking
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('hf', 'huggingface', 'twitter', 'x', 'scholar', 'arxiv_authors', 'alphaxiv', 'arxiv', 'finance', 'rss')),
      name TEXT NOT NULL,
      config TEXT DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      last_checked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Recovery: previous failed migrations may leave tracker_sources_bak behind.
  // Merge recoverable rows back before continuing, then drop stale backup table.
  try {
    const bakTable = await db.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'tracker_sources_bak'
      LIMIT 1
    `);
    if ((bakTable.rows || []).length > 0) {
      console.warn('[Migration] Found stale tracker_sources_bak; attempting recovery merge...');
      await db.execute(`
        INSERT OR IGNORE INTO tracker_sources (id, type, name, config, enabled, last_checked_at, created_at)
        SELECT
          id,
          CASE LOWER(type)
            WHEN 'huggingface' THEN 'hf'
            WHEN 'x' THEN 'twitter'
            WHEN 'arxiv' THEN 'alphaxiv'
            ELSE type
          END,
          name,
          config,
          enabled,
          last_checked_at,
          created_at
        FROM tracker_sources_bak
      `);
      await db.execute(`DROP TABLE tracker_sources_bak`);
      console.log('[Migration] tracker_sources_bak recovered and removed');
    }
  } catch (recoverErr) {
    console.warn('[Migration] Could not recover stale tracker_sources_bak:', recoverErr.message);
  }

  // Migration: ensure tracker_sources type CHECK includes all supported types + legacy aliases.
  let trackerSourceTypeConstraintOk = true;
  for (const testType of ['rss', 'arxiv_authors', 'arxiv', 'huggingface']) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await db.execute({
        sql: `INSERT INTO tracker_sources (type, name) VALUES (?, ?)`,
        args: [testType, '__migration_test__'],
      });
      // eslint-disable-next-line no-await-in-loop
      await db.execute({ sql: `DELETE FROM tracker_sources WHERE name = '__migration_test__'`, args: [] });
    } catch (probeErr) {
      if (probeErr.message?.toLowerCase().includes('check') || probeErr.message?.toLowerCase().includes('constraint')) {
        trackerSourceTypeConstraintOk = false;
        break;
      }
    }
  }
  if (!trackerSourceTypeConstraintOk) {
    console.log('[Migration] Updating tracker_sources type CHECK constraint...');
    const backupTable = 'tracker_sources_mig_bak';
    await db.execute(`DROP TABLE IF EXISTS ${backupTable}`);
    await db.execute(`ALTER TABLE tracker_sources RENAME TO ${backupTable}`);
    await db.execute(`
      CREATE TABLE tracker_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('hf', 'huggingface', 'twitter', 'x', 'scholar', 'arxiv_authors', 'alphaxiv', 'arxiv', 'finance', 'rss')),
        name TEXT NOT NULL,
        config TEXT DEFAULT '{}',
        enabled INTEGER DEFAULT 1,
        last_checked_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try {
      await db.execute(`
        INSERT INTO tracker_sources (id, type, name, config, enabled, last_checked_at, created_at)
        SELECT
          id,
          CASE LOWER(type)
            WHEN 'huggingface' THEN 'hf'
            WHEN 'x' THEN 'twitter'
            WHEN 'arxiv' THEN 'alphaxiv'
            ELSE type
          END,
          name,
          config,
          enabled,
          last_checked_at,
          created_at
        FROM ${backupTable}
      `);
      await db.execute(`DROP TABLE ${backupTable}`);
      console.log('[Migration] tracker_sources updated');
    } catch (migrationCopyErr) {
      console.error('[Migration] tracker_sources migration copy failed; rolling back:', migrationCopyErr.message);
      await db.execute(`DROP TABLE IF EXISTS tracker_sources`);
      await db.execute(`ALTER TABLE ${backupTable} RENAME TO tracker_sources`);
      throw migrationCopyErr;
    }
  }

  // Audit trail for tracker source CRUD to prevent silent source-loss incidents.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_sources_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER,
      op TEXT NOT NULL CHECK(op IN ('insert', 'update', 'delete')),
      type TEXT,
      name TEXT,
      config TEXT,
      enabled INTEGER,
      captured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_sources_audit_source_time
    ON tracker_sources_audit(source_id, captured_at DESC)
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_tracker_sources_audit_insert
    AFTER INSERT ON tracker_sources
    BEGIN
      INSERT INTO tracker_sources_audit (source_id, op, type, name, config, enabled)
      VALUES (NEW.id, 'insert', NEW.type, NEW.name, NEW.config, NEW.enabled);
    END
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_tracker_sources_audit_update
    AFTER UPDATE ON tracker_sources
    BEGIN
      INSERT INTO tracker_sources_audit (source_id, op, type, name, config, enabled)
      VALUES (NEW.id, 'update', NEW.type, NEW.name, NEW.config, NEW.enabled);
    END
  `);
  await db.execute(`
    CREATE TRIGGER IF NOT EXISTS trg_tracker_sources_audit_delete
    AFTER DELETE ON tracker_sources
    BEGIN
      INSERT INTO tracker_sources_audit (source_id, op, type, name, config, enabled)
      VALUES (OLD.id, 'delete', OLD.type, OLD.name, OLD.config, OLD.enabled);
    END
  `);

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

  // Persisted tracker feed snapshot (metadata only; no PDFs) for fast pagination.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_feed_cache (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      fetched_at DATETIME NOT NULL,
      data_json TEXT NOT NULL,
      per_source_json TEXT DEFAULT '[]',
      source_count INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tracker interaction events for feed personalization and ranking evaluation.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tracker_item_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      item_key TEXT NOT NULL,
      item_type TEXT DEFAULT '',
      arxiv_id TEXT DEFAULT '',
      url TEXT DEFAULT '',
      source_type TEXT DEFAULT '',
      source_name TEXT DEFAULT '',
      rank_position INTEGER DEFAULT 0,
      rank_score REAL DEFAULT 0,
      metadata_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_item_events_user_time
    ON tracker_item_events(user_id, created_at DESC)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_item_events_user_event_time
    ON tracker_item_events(user_id, event_type, created_at DESC)
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_tracker_item_events_item_key_time
    ON tracker_item_events(item_key, created_at DESC)
  `);

  // Knowledge groups for research mode / vibe workspace KB
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      user_id TEXT NOT NULL DEFAULT 'czk',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_groups_user_updated
    ON knowledge_groups(user_id, updated_at DESC)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_group_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      document_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES knowledge_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      UNIQUE(group_id, document_id)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_group_documents_group
    ON knowledge_group_documents(group_id, created_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_group_documents_document
    ON knowledge_group_documents(document_id)
  `);

  // Knowledge assets (documents + external insights/files/notes/reports)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL DEFAULT 'czk',
      asset_type TEXT NOT NULL CHECK(asset_type IN ('document', 'insight', 'file', 'note', 'report')),
      title TEXT NOT NULL,
      summary TEXT,
      body_md TEXT,
      external_document_id INTEGER,
      source_provider TEXT,
      source_session_id TEXT,
      source_message_id TEXT,
      source_url TEXT,
      object_key TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      content_sha256 TEXT,
      tags TEXT DEFAULT '[]',
      metadata_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (external_document_id) REFERENCES documents(id) ON DELETE SET NULL
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_user_updated
    ON knowledge_assets(user_id, updated_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_type_updated
    ON knowledge_assets(user_id, asset_type, updated_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_assets_external_document
    ON knowledge_assets(external_document_id)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_group_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      asset_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES knowledge_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
      UNIQUE(group_id, asset_id)
    )
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_group_assets_group
    ON knowledge_group_assets(group_id, created_at DESC)
  `);

  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_knowledge_group_assets_asset
    ON knowledge_group_assets(asset_id)
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS knowledge_asset_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_id INTEGER NOT NULL,
      version INTEGER NOT NULL,
      body_md TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (asset_id) REFERENCES knowledge_assets(id) ON DELETE CASCADE,
      UNIQUE(asset_id, version)
    )
  `);

  // Backfill document-backed knowledge assets.
  await db.execute(`
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
    )
    SELECT
      COALESCE(d.user_id, 'czk') AS user_id,
      'document' AS asset_type,
      d.title AS title,
      NULL AS summary,
      NULL AS body_md,
      d.id AS external_document_id,
      'documents' AS source_provider,
      NULL AS source_session_id,
      NULL AS source_message_id,
      d.original_url AS source_url,
      d.s3_key AS object_key,
      d.mime_type AS mime_type,
      d.file_size AS size_bytes,
      NULL AS content_sha256,
      COALESCE(d.tags, '[]') AS tags,
      '{}' AS metadata_json
    FROM documents d
    LEFT JOIN knowledge_assets ka
      ON ka.external_document_id = d.id
      AND ka.asset_type = 'document'
      AND ka.user_id = COALESCE(d.user_id, 'czk')
    WHERE ka.id IS NULL
  `);

  // Backfill legacy knowledge_group_documents links into knowledge_group_assets.
  await db.execute(`
    INSERT OR IGNORE INTO knowledge_group_assets (group_id, asset_id)
    SELECT
      kgd.group_id,
      ka.id
    FROM knowledge_group_documents kgd
    JOIN knowledge_groups kg ON kg.id = kgd.group_id
    JOIN documents d ON d.id = kgd.document_id
    JOIN knowledge_assets ka
      ON ka.external_document_id = d.id
      AND ka.asset_type = 'document'
      AND ka.user_id = kg.user_id
  `);

  // Agent session cache: persists observed Claude Code / Codex sessions across processing server restarts
  await db.execute(`
    CREATE TABLE IF NOT EXISTS agent_session_cache (
      session_id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      data TEXT NOT NULL,
      cached_at TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_agent_session_cache_path_cached
    ON agent_session_cache(project_path, cached_at DESC)
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
