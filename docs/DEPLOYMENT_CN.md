# 部署指南

本指南介绍如何将 Auto Reader 部署到生产环境。

## 架构概览

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   前端          │────▶│   后端 API      │────▶│   AWS S3        │
│  (GitHub Pages) │     │  (VPS服务器)    │     │  (文件存储)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Turso 数据库   │
                        │  (SQLite 云端)  │
                        └─────────────────┘
```

## 前置条件

- Node.js 20.x 或更高版本
- Git
- VPS 或云服务器（DigitalOcean、AWS EC2 等）
- AWS S3 存储桶
- Turso 数据库账号（有免费套餐）
- 域名（可选但推荐）

## 后端部署

### 方式一：使用部署脚本

项目包含部署脚本 `scripts/deploy.sh`。

```bash
# 首次设置
./scripts/deploy.sh setup

# 复制环境变量文件
./scripts/deploy.sh copy-env

# 部署
./scripts/deploy.sh deploy
```

### 方式二：手动部署

1. **SSH 登录服务器：**
   ```bash
   ssh user@你的服务器IP
   ```

2. **安装 Node.js：**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **安装 PM2：**
   ```bash
   sudo npm install -g pm2
   ```

4. **克隆仓库：**
   ```bash
   git clone https://github.com/CurryTang/auto-researcher.git
   cd auto-researcher/backend
   ```

5. **安装依赖：**
   ```bash
   npm ci --production
   ```

6. **创建环境变量文件：**
   ```bash
   cp .env.example .env
   nano .env  # 编辑填入你的凭证
   ```

7. **使用 PM2 启动：**
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   ```

### Nginx 反向代理（推荐）

```nginx
server {
    listen 80;
    server_name api.你的域名.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 配置 SSL（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.你的域名.com
```

## 前端部署

前端部署到 GitHub Pages。

### 手动部署

```bash
cd frontend
npm install
npm run build
npx gh-pages -d dist
```

### 配置

更新 `frontend/src/App.jsx` 中的 API 地址：

```javascript
const API_URL = 'https://api.你的域名.com/api';
```

同时更新 `vite.config.js` 中的基础路径：

```javascript
base: '/你的仓库名/',
```

## Chrome 浏览器扩展

Chrome 扩展需要配置你的 API 地址：

1. 打开扩展设置（点击齿轮图标）
2. 更新 Backend API URL 为你的服务器地址
3. 在 Chrome 中加载未打包的扩展

## 数据库设置

### Turso（推荐）

1. 在 [turso.tech](https://turso.tech) 创建账号
2. 创建新数据库
3. 获取数据库 URL 和认证令牌
4. 添加到 `.env`：
   ```
   TURSO_DATABASE_URL=libsql://你的数据库.turso.io
   TURSO_AUTH_TOKEN=你的令牌
   ```

### 本地 SQLite（开发用）

```
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=
```

## AWS S3 设置

详见 [S3_SETUP_GUIDE.md](./S3_SETUP_GUIDE.md)。

快速设置：
1. 创建 S3 存储桶
2. 创建具有 S3 权限的 IAM 用户
3. 添加凭证到 `.env`：
   ```
   AWS_ACCESS_KEY_ID=你的密钥ID
   AWS_SECRET_ACCESS_KEY=你的密钥
   AWS_REGION=us-east-1
   AWS_S3_BUCKET=你的存储桶名称
   ```

## Gemini CLI 设置（论文分析必需）

论文分析功能使用 Google 的 Gemini CLI。

1. 安装 Gemini CLI：
   ```bash
   npm install -g @google/gemini-cli
   ```

2. 认证：
   ```bash
   gemini auth
   ```

3. 验证安装：
   ```bash
   gemini -v
   ```

## 健康检查

部署后验证一切正常：

```bash
# 检查 API 健康状态
curl https://api.你的域名.com/api/health

# 检查 PM2 状态
pm2 status

# 查看日志
pm2 logs auto-reader-api
```

## 更新

```bash
# 快速更新（拉取并重启）
./scripts/deploy.sh quick

# 完整重新部署
./scripts/deploy.sh deploy
```

## 故障排除

### 后端无法启动

查看日志：
```bash
pm2 logs auto-reader-api --lines 50
```

常见问题：
- 环境变量缺失
- 数据库连接失败
- 端口已被占用

### 前端显示空白页

- 检查浏览器控制台错误
- 验证 API 地址正确
- 清除浏览器缓存

### 论文分析不工作

- 验证 Gemini CLI 已安装：`gemini -v`
- 检查 Gemini 认证：`gemini auth`
- 检查服务器日志
