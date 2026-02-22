require('dotenv').config();
const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  // Authentication
  auth: {
    enabled: process.env.AUTH_ENABLED !== 'false', // Enabled by default
    adminToken: process.env.ADMIN_TOKEN,
    salt: process.env.AUTH_SALT || 'auto-reader-secure-salt-2024',
    jwtSecret: process.env.JWT_SECRET || 'auto-reader-jwt-fallback-secret-change-in-production',
  },

  turso: {
    url: process.env.TURSO_DATABASE_URL || 'file:local.db',
    authToken: process.env.TURSO_AUTH_TOKEN || '',
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'auto-reader-documents',
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },

  // Rate Limiting Configuration
  rateLimit: {
    // General API rate limit
    general: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX) || 200, // requests per window
    },
    // Paper/document processing rate limit
    paperAnalysis: {
      windowMs: parseInt(process.env.PAPER_ANALYSIS_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.PAPER_ANALYSIS_MAX) || 30, // 30 per hour
    },
    // Code analysis rate limit
    codeAnalysis: {
      windowMs: parseInt(process.env.CODE_ANALYSIS_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.CODE_ANALYSIS_MAX) || 20, // 20 per hour
    },
    // File upload rate limit
    upload: {
      windowMs: parseInt(process.env.UPLOAD_WINDOW_MS) || 60 * 60 * 1000, // 1 hour
      max: parseInt(process.env.UPLOAD_MAX) || 50, // 50 per hour
    },
  },

  // Document Reader Configuration
  reader: {
    enabled: process.env.READER_ENABLED !== 'false', // Enabled by default
    scanIntervalMs: parseInt(process.env.READER_SCAN_INTERVAL_MS) || 30 * 60 * 1000, // 30 minutes
    processIntervalMs: parseInt(process.env.READER_PROCESS_INTERVAL_MS) || 60 * 1000, // 1 minute
    maxPerHour: parseInt(process.env.READER_MAX_PER_HOUR) || 5,
    maxPageCount: parseInt(process.env.READER_MAX_PAGE_COUNT) || 40,
    maxFileSizeMb: parseInt(process.env.READER_MAX_FILE_SIZE_MB) || 5,
    // IMPORTANT: Must be 1 to prevent session cross-contamination.
    // CLI tools (Gemini, Codex) share session state in their config dirs.
    // Concurrent calls can cause notes from one paper to leak into another.
    // This is the sole mechanism for isolation — do not increase without
    // adding per-process session isolation that preserves auth credentials.
    concurrency: parseInt(process.env.READER_CONCURRENCY) || 1,
    defaultProvider: process.env.READER_DEFAULT_PROVIDER || 'codex-cli',
    // Use project directory for tmp files - Gemini CLI can only access files within project
    // Using 'processing' instead of 'tmp' to avoid .gitignore issues
    tmpDir: process.env.READER_TMP_DIR || path.join(__dirname, '..', '..', 'processing'),
  },

  // Mathpix API (for large PDF conversion)
  mathpix: {
    appId: process.env.MATHPIX_APP_ID,
    appKey: process.env.MATHPIX_APP_KEY,
  },

  // Gemini CLI Configuration
  geminiCli: {
    path: process.env.GEMINI_CLI_PATH || 'gemini',
    model: process.env.GEMINI_CLI_MODEL || 'gemini-3-flash-preview',
  },

  // Google API Configuration (Google Developer Platform)
  googleApi: {
    apiKey: process.env.GOOGLE_API_KEY,
    model: process.env.GOOGLE_API_MODEL || 'gemini-3-flash-preview',
  },

  // Codex CLI Configuration (OpenAI Codex)
  codexCli: {
    path: process.env.CODEX_CLI_PATH || 'codex',
    model: process.env.CODEX_CLI_MODEL || 'gpt-5.1-codex-mini',
    sandbox: process.env.CODEX_CLI_SANDBOX || 'workspace-write',
    approval: process.env.CODEX_CLI_APPROVAL || 'never',
  },

  // Claude Code CLI Configuration
  claudeCli: {
    path: process.env.CLAUDE_CLI_PATH || 'claude',
    model: process.env.CLAUDE_CLI_MODEL || 'claude-haiku-4-5-20251001',
    apiKey: process.env.ANTHROPIC_API_KEY,
  },

  // LLM API Configuration (for fallback)
  llm: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-3-sonnet-20240229',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4-turbo',
    },
    qwen: {
      apiKey: process.env.QWEN_API_KEY,
      model: process.env.QWEN_MODEL || 'qwen-max',
      baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    },
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY,
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    },
  },

  // Desktop Processing via FRP
  processing: {
    enabled: process.env.PROCESSING_ENABLED !== 'false', // Enable by default
    desktopUrl: process.env.PROCESSING_DESKTOP_URL || 'http://127.0.0.1:7001',
    timeout: parseInt(process.env.PROCESSING_TIMEOUT) || 300000, // 5 minutes
  },

  // Paper Tracker Configuration
  tracker: {
    // Enable/disable local tracker scheduler on this node
    enabled: process.env.TRACKER_ENABLED !== 'false',
    // Forward heavy tracker operations (run/preview) to desktop via FRP
    proxyHeavyOps: process.env.TRACKER_PROXY_HEAVY_OPS === 'true',
    desktopUrl: process.env.TRACKER_DESKTOP_URL || process.env.PROCESSING_DESKTOP_URL || 'http://127.0.0.1:7001',
    timeout: parseInt(process.env.TRACKER_PROXY_TIMEOUT) || 120000,
  },
};
