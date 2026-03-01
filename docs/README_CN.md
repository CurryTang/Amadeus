# Auto Researcher 中文文档

[English](../README.md) | **中文文档**

## 截图

| 网页界面 | Chrome 扩展 |
|:---:|:---:|
| ![主页](../assets/demo_homepage.png) | ![Chrome 扩展](../assets/demo_chrome.png) |

## 功能特点

- **一键保存论文** - Chrome 扩展支持从 arXiv、OpenReview 等网站及任意 PDF 链接保存论文
- **AI 智能摘要** - 多轮深度阅读，自动生成包含图表和公式的完整笔记
- **代码分析** - 自动分析关联的 GitHub 仓库
- **论文追踪器** - 订阅作者或关键词，每日从 Semantic Scholar 和 Twitter/X 抓取最新论文
- **Vibe Researcher** - 基于 DAG 的智能研究流水线：定义任务、Claude 自动执行、审查输出、发布成果
- **知识库** - 跨论文和项目收集、标注、关联可复用的知识片段
- **SSH 服务器管理** - 注册远程计算节点，Agent 任务通过 SSH 下发到远端执行
- **阅读追踪** - 标记论文已读/未读状态，筛选你的文库
- **全文搜索** - 按标题、标签和内容查找论文

## 架构

安装脚本支持选择部署模式，常见选项：

- **一体化部署** — 后端、前端和 AI 均运行在同一台机器上（本地或云端）
- **代理 + 本地设备** — 低配云服务器（如 DigitalOcean）通过 [FRP](https://github.com/fatedier/frp) 作为纯 HTTPS 代理，将流量转发至运行所有服务的本地设备（WSL/家用 PC）

```
# 代理 + 本地设备模式
┌──────────┐     ┌───────────────────────┐     ┌──────────────────────────┐
│   用户    │────▶│  云服务器（代理）        │────▶│  本地设备（WSL/PC）        │
│          │     │  nginx + frps          │     │  PM2: API + 前端          │
└──────────┘     └───────────────────────┘     │  MongoDB, Turso, S3      │
                                                └──────────────────────────┘
```

代理模式下，所有繁重的 AI 工作负载（Claude Code CLI、Gemini CLI）均在你自己的硬件上运行，无需云 GPU 费用。详见[安装模式](INSTALLATION_MODES.md)。

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/CurryTang/auto-researcher.git
cd auto-researcher
```

### 2. 生成配置文件

```bash
./scripts/install.sh
# 生成：
# - backend/.env.generated
# - frontend/.env.generated
# - deployment.mode.generated
# 同时可选择前端/后端的编译和部署目标。
```

### 3. 应用配置

```bash
cp backend/.env.generated backend/.env
cp frontend/.env.generated frontend/.env
```

### 4. 启动后端和前端

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

### 5. 安装 Chrome 扩展

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `chrome-extension/` 文件夹

## 工作原理

### 论文处理流程

1. **保存** - Chrome 扩展捕获论文元数据和 PDF
2. **排队** - 论文加入处理队列
3. **分析** - AI 进行 3 轮深度阅读：
   - 第1轮：鸟瞰扫描（结构、关键页面）
   - 第2轮：内容理解（方法、结果）
   - 第3轮：深度分析（数学、图表）
4. **存储** - 笔记保存到对象存储（S3/MinIO/OSS）
5. **查看** - 渲染包含 Mermaid 图表和 KaTeX 公式的精美笔记

### Vibe Researcher（ResearchOps）

定义 YAML/JSON DAG 工作流，编排器自动执行每个步骤：
- `agent.run` — 在注册的 SSH 服务器（或本地）上启动 Claude Code Agent
- `agent.review` — 自动注入在每个 `agent.run` 之后，审查输出，失败时自动修复重试
- `bash.run` — 在注册的 SSH 服务器上执行 shell 命令
- `checkpoint.hitl` — 人工介入检查点，继续前等待人工确认
- `report.render` — 从步骤输出生成 Markdown/HTML 报告
- `artifact.publish` — 将结果提交到 git 分支

### 论文追踪器

订阅 Semantic Scholar 作者 ID 或关键词查询，追踪器每日运行并在信息流中展示新论文。也支持监控 Twitter/X 账号（基于 Playwright，实验性功能）。

## 文档

- [部署指南](DEPLOYMENT_CN.md) - 如何部署到生产环境
- [DO + FRP + Tailscale](DO_FRP_TAILSCALE.md) - 代理 + FRP + VPN 配置
- [Tracker 认证指南](TRACKER_AUTH.md) - Google Scholar 和 Twitter/X 追踪器认证配置
- [S3 设置指南](S3_SETUP_GUIDE.md) - 对象存储配置（S3/MinIO/OSS）
- [安装模式](INSTALLATION_MODES.md) - 部署模式与提供商矩阵
- [配置指南](CONFIGURATION.md) - 所有配置选项

## 技术栈

**前端：**
- React 18 + Next.js（Standalone 模式）
- React Markdown + KaTeX + Mermaid
- PM2 运行在本地设备，通过 FRP 代理

**后端：**
- Node.js + Express
- Turso / 本地 SQLite（文档元数据）
- MongoDB / MongoDB Atlas（ResearchOps 运行元数据）
- AWS S3 / MinIO / 阿里云 OSS（论文对象存储）
- PM2 进程管理

**AI：**
- Claude Code CLI（Agent 运行、代码分析、Vibe Researcher）
- Google Gemini CLI（论文分析）

## 配置

主要环境变量：

```bash
# 文档元数据（本地 SQLite 或 Turso 云端）
TURSO_DATABASE_URL=file:./local.db
# TURSO_DATABASE_URL=libsql://你的数据库.turso.io
TURSO_AUTH_TOKEN=

# ResearchOps 元数据（本地 Mongo 或 Atlas）
MONGODB_URI=mongodb://127.0.0.1:27017/auto_researcher
# MONGODB_URI=mongodb+srv://<用户>:<密码>@<集群>.mongodb.net/auto_researcher

# 对象存储（aws-s3 | minio | aliyun-oss）
OBJECT_STORAGE_PROVIDER=aws-s3
OBJECT_STORAGE_BUCKET=你的存储桶
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY_ID=你的密钥ID
OBJECT_STORAGE_SECRET_ACCESS_KEY=你的密钥

# 认证
ADMIN_TOKEN=你的管理员令牌  # 用于写操作

# 可选
TRACKER_PROXY_HEAVY_OPS=true
TAILSCALE_ENABLED=false
```

详见[配置指南](CONFIGURATION.md)。

## 开发

```bash
# 后端（支持热重载）
cd backend && npm run dev

# 前端（支持热重载）
cd frontend && npm run dev
```

## 实验性：Twitter/X 论文抓取（Playwright）

1. 安装后端依赖和 Playwright 浏览器：
```bash
cd backend
npm install
npx playwright install chromium
```

2. （可选但推荐）提供已登录的存储状态：
```bash
X_PLAYWRIGHT_STORAGE_STATE_PATH=/path/to/x-state.json
```

3. 运行抓取器：
```bash
npm run exp:x-papers -- --links "https://x.com/karpathy,https://x.com/ylecun" --out ./x-paper-posts.json
```

Tracker 管理界面支持 Twitter 来源模式 `Playwright（实验性）`，可配置多个账号链接，默认每日运行（`crawlIntervalHours=24`）。

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 许可证

MIT 许可证 - 详见 [LICENSE](../LICENSE)。

## 致谢

- [Gemini](https://deepmind.google/technologies/gemini/) 提供论文分析
- [Claude](https://claude.ai/) 提供 Agent 研究自动化
- [Mermaid](https://mermaid.js.org/) 提供图表渲染
- [KaTeX](https://katex.org/) 提供数学公式渲染
