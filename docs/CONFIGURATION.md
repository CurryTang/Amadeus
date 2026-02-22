# Configuration Guide

This guide covers all configuration options for Auto Reader.

## Environment Variables

Create a `.env` file in the `backend/` directory with these settings:

### Required Settings

```bash
# Database (Turso)
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-auth-token

# AWS S3 Storage
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

### Server Settings

```bash
# Server
PORT=3000
NODE_ENV=production

# CORS (comma-separated origins, or * for all)
CORS_ORIGIN=https://yourdomain.github.io,https://yourdomain.com
```

### Authentication

The application uses token-based authentication to protect write operations.

```bash
# Admin token for write operations (required)
ADMIN_TOKEN=your-secret-token-here

# Optional: custom salt for token hashing (defaults to a secure value)
AUTH_SALT=your-custom-salt

# Optional: disable auth entirely (not recommended for production)
AUTH_ENABLED=true
```

**Generating a secure token:**
```bash
# Using OpenSSL
openssl rand -hex 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Protected endpoints:**
- All POST, PUT, DELETE, PATCH operations require authentication
- GET operations (viewing documents, notes) remain public

**Using the token:**
- **Frontend:** Click "Login" button in the header and enter your token
- **Extension:** No token needed (Chrome extensions are automatically trusted)
- **API:** Include `Authorization: Bearer <token>` header

### Rate Limiting

Control API rate limits to prevent abuse:

```bash
# General API rate limit
RATE_LIMIT_WINDOW_MS=900000      # 15 minutes (in milliseconds)
RATE_LIMIT_MAX=200               # Max requests per window

# Paper analysis rate limit
PAPER_ANALYSIS_WINDOW_MS=3600000 # 1 hour
PAPER_ANALYSIS_MAX=30            # 30 analyses per hour

# Code analysis rate limit
CODE_ANALYSIS_WINDOW_MS=3600000  # 1 hour
CODE_ANALYSIS_MAX=20             # 20 analyses per hour

# File upload rate limit
UPLOAD_WINDOW_MS=3600000         # 1 hour
UPLOAD_MAX=50                    # 50 uploads per hour
```

### Document Reader Settings

Control the automatic paper processing:

```bash
# Enable/disable automatic processing
READER_ENABLED=true

# How often to scan for new documents (milliseconds)
READER_SCAN_INTERVAL_MS=1800000  # 30 minutes

# How often to check queue (milliseconds)
READER_PROCESS_INTERVAL_MS=60000 # 1 minute

# Maximum papers to process per hour
READER_MAX_PER_HOUR=5

# Maximum pages per paper (papers are truncated)
READER_MAX_PAGE_COUNT=40

# Maximum file size in MB (larger files use Mathpix)
READER_MAX_FILE_SIZE_MB=5

# Default AI provider
READER_DEFAULT_PROVIDER=gemini-cli
```

### AI Provider Settings

#### Gemini CLI (Primary)

```bash
GEMINI_CLI_PATH=gemini
```

#### Claude Code CLI (for code analysis)

```bash
CLAUDE_CLI_PATH=claude
CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your-anthropic-key
```

#### Fallback LLM APIs

```bash
# Gemini API
GEMINI_API_KEY=your-gemini-key
GEMINI_MODEL=gemini-1.5-pro

# Anthropic API
ANTHROPIC_API_KEY=your-anthropic-key
ANTHROPIC_MODEL=claude-3-sonnet-20240229

# OpenAI API
OPENAI_API_KEY=your-openai-key
OPENAI_MODEL=gpt-4-turbo

# Qwen API
QWEN_API_KEY=your-qwen-key
QWEN_MODEL=qwen-max
QWEN_BASE_URL=https://dashscope.aliyuncs.com/api/v1

# DeepSeek API
DEEPSEEK_API_KEY=your-deepseek-key
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

#### Mathpix (for large PDFs)

```bash
MATHPIX_APP_ID=your-app-id
MATHPIX_APP_KEY=your-app-key
```

## Frontend Configuration

### API URL

Edit `frontend/src/App.jsx`:

```javascript
const API_URL = 'https://your-api-domain.com/api';
```

### GitHub Pages Base Path

Edit `frontend/vite.config.js`:

```javascript
export default defineConfig({
  base: '/your-repo-name/',
  // ...
});
```

## Chrome Extension Configuration

### Settings

Open extension settings (click gear icon) to configure:

1. **Backend API URL** - Your Auto Reader server URL
2. **Presets** - Site-specific detection patterns (arXiv, IEEE, etc.)

Note: The extension doesn't require authentication since it runs locally on your machine. The backend automatically trusts requests from Chrome extensions.

### Permissions

The extension requires these permissions in `manifest.json`:
- `activeTab` - Access current tab
- `storage` - Store settings and auth token
- `host_permissions` - Access paper websites

## PM2 Configuration

The `backend/ecosystem.config.js` file configures PM2:

```javascript
module.exports = {
  apps: [{
    name: 'auto-reader-api',
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};
```

Adjust `instances` based on your server's CPU cores.

## Rate Limit Recommendations

| Use Case | RATE_LIMIT_MAX | PAPER_ANALYSIS_MAX |
|----------|----------------|-------------------|
| Personal | 200 | 30 |
| Small Team | 500 | 50 |
| Lab/Organization | 1000 | 100 |

## Security Recommendations

1. **Never commit `.env` files** - They contain secrets
2. **Use HTTPS** - Enable SSL with Let's Encrypt
3. **Restrict CORS** - Set specific origins, not `*`
4. **Use strong tokens** - Generate random auth tokens
5. **Regular updates** - Keep dependencies updated

## Monitoring

### PM2 Monitoring

```bash
pm2 monit          # Real-time monitoring
pm2 status         # Process status
pm2 logs           # View logs
```

### Health Check Endpoint

```bash
curl https://your-api.com/api/health
# Returns: {"status":"ok","timestamp":"..."}
```

## Backup

### Database

Turso handles backups automatically. For local SQLite:

```bash
sqlite3 local.db ".backup backup.db"
```

### S3 Files

Enable S3 versioning for automatic file backups:

```bash
aws s3api put-bucket-versioning \
  --bucket your-bucket \
  --versioning-configuration Status=Enabled
```
