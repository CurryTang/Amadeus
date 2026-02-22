# 配置指南

本指南涵盖 Auto Reader 的所有配置选项。

## 环境变量

在 `backend/` 目录创建 `.env` 文件，包含以下设置：

### 必需设置

```bash
# 数据库 (Turso)
TURSO_DATABASE_URL=libsql://你的数据库.turso.io
TURSO_AUTH_TOKEN=你的认证令牌

# AWS S3 存储
AWS_ACCESS_KEY_ID=你的访问密钥ID
AWS_SECRET_ACCESS_KEY=你的访问密钥
AWS_REGION=us-east-1
AWS_S3_BUCKET=你的存储桶名称
```

### 服务器设置

```bash
# 服务器
PORT=3000
NODE_ENV=production

# CORS（逗号分隔的来源，或 * 表示全部）
CORS_ORIGIN=https://你的域名.github.io,https://你的域名.com
```

### 认证

应用使用基于令牌的认证来保护写操作。

```bash
# 写操作的管理员令牌（必需）
ADMIN_TOKEN=你的密钥令牌

# 可选：令牌哈希的自定义盐值（默认为安全值）
AUTH_SALT=你的自定义盐值

# 可选：完全禁用认证（不建议在生产环境使用）
AUTH_ENABLED=true
```

**生成安全令牌：**
```bash
# 使用 OpenSSL
openssl rand -hex 32

# 使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**受保护的端点：**
- 所有 POST、PUT、DELETE、PATCH 操作需要认证
- GET 操作（查看文档、笔记）保持公开

**使用令牌：**
- **前端：** 点击页头的"Login"按钮并输入令牌
- **扩展：** 无需令牌（Chrome 扩展自动受信任）
- **API：** 包含 `Authorization: Bearer <令牌>` 头

### 速率限制

控制 API 速率限制以防止滥用：

```bash
# 通用 API 速率限制
RATE_LIMIT_WINDOW_MS=900000      # 15 分钟（毫秒）
RATE_LIMIT_MAX=200               # 每个窗口最大请求数

# 论文分析速率限制
PAPER_ANALYSIS_WINDOW_MS=3600000 # 1 小时
PAPER_ANALYSIS_MAX=30            # 每小时 30 次分析

# 代码分析速率限制
CODE_ANALYSIS_WINDOW_MS=3600000  # 1 小时
CODE_ANALYSIS_MAX=20             # 每小时 20 次分析

# 文件上传速率限制
UPLOAD_WINDOW_MS=3600000         # 1 小时
UPLOAD_MAX=50                    # 每小时 50 次上传
```

### 文档阅读器设置

控制自动论文处理：

```bash
# 启用/禁用自动处理
READER_ENABLED=true

# 扫描新文档的频率（毫秒）
READER_SCAN_INTERVAL_MS=1800000  # 30 分钟

# 检查队列的频率（毫秒）
READER_PROCESS_INTERVAL_MS=60000 # 1 分钟

# 每小时最大处理论文数
READER_MAX_PER_HOUR=5

# 每篇论文最大页数（超出会截断）
READER_MAX_PAGE_COUNT=40

# 最大文件大小（MB）（更大的文件使用 Mathpix）
READER_MAX_FILE_SIZE_MB=5

# 默认 AI 提供商
READER_DEFAULT_PROVIDER=gemini-cli
```

### AI 提供商设置

#### Gemini CLI（主要）

```bash
GEMINI_CLI_PATH=gemini
```

#### Claude Code CLI（用于代码分析）

```bash
CLAUDE_CLI_PATH=claude
CLAUDE_CLI_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=你的anthropic密钥
```

#### 备用 LLM API

```bash
# Gemini API
GEMINI_API_KEY=你的gemini密钥
GEMINI_MODEL=gemini-1.5-pro

# Anthropic API
ANTHROPIC_API_KEY=你的anthropic密钥
ANTHROPIC_MODEL=claude-3-sonnet-20240229

# OpenAI API
OPENAI_API_KEY=你的openai密钥
OPENAI_MODEL=gpt-4-turbo

# 通义千问 API
QWEN_API_KEY=你的qwen密钥
QWEN_MODEL=qwen-max
QWEN_BASE_URL=https://dashscope.aliyuncs.com/api/v1

# DeepSeek API
DEEPSEEK_API_KEY=你的deepseek密钥
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

#### Mathpix（用于大型 PDF）

```bash
MATHPIX_APP_ID=你的应用ID
MATHPIX_APP_KEY=你的应用密钥
```

## 前端配置

### API 地址

编辑 `frontend/src/App.jsx`：

```javascript
const API_URL = 'https://你的api域名.com/api';
```

### GitHub Pages 基础路径

编辑 `frontend/vite.config.js`：

```javascript
export default defineConfig({
  base: '/你的仓库名/',
  // ...
});
```

## Chrome 扩展配置

### 设置

打开扩展设置（点击齿轮图标）配置：

1. **Backend API URL** - 你的 Auto Reader 服务器地址
2. **Presets** - 网站特定检测模式（arXiv、IEEE 等）

注意：扩展不需要认证，因为它在本地运行。后端自动信任来自 Chrome 扩展的请求。

### 权限

扩展在 `manifest.json` 中需要这些权限：
- `activeTab` - 访问当前标签页
- `storage` - 存储设置
- `host_permissions` - 访问论文网站

## PM2 配置

`backend/ecosystem.config.js` 文件配置 PM2：

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

根据服务器 CPU 核心数调整 `instances`。

## 速率限制建议

| 使用场景 | RATE_LIMIT_MAX | PAPER_ANALYSIS_MAX |
|----------|----------------|-------------------|
| 个人使用 | 200 | 30 |
| 小团队 | 500 | 50 |
| 实验室/组织 | 1000 | 100 |

## 安全建议

1. **永远不要提交 `.env` 文件** - 它们包含敏感信息
2. **使用 HTTPS** - 使用 Let's Encrypt 启用 SSL
3. **限制 CORS** - 设置特定来源，不要用 `*`
4. **使用强令牌** - 生成随机认证令牌
5. **定期更新** - 保持依赖更新

## 监控

### PM2 监控

```bash
pm2 monit          # 实时监控
pm2 status         # 进程状态
pm2 logs           # 查看日志
```

### 健康检查端点

```bash
curl https://你的api.com/api/health
# 返回: {"status":"ok","timestamp":"..."}
```

## 备份

### 数据库

Turso 自动处理备份。本地 SQLite：

```bash
sqlite3 local.db ".backup backup.db"
```

### S3 文件

启用 S3 版本控制自动备份文件：

```bash
aws s3api put-bucket-versioning \
  --bucket 你的存储桶 \
  --versioning-configuration Status=Enabled
```
