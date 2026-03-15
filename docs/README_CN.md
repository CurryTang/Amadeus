# Amadeus 中文文档

[English](../README.md) | **中文文档**

---

## 截图

| 网页界面 | Chrome 扩展 |
|:---:|:---:|
| ![主页](../assets/demo_homepage.png) | ![Chrome 扩展](../assets/demo_chrome.png) |

## 功能特点

### 论文管理
- **一键保存论文** — Chrome 扩展支持 arXiv、OpenReview 及任意 PDF 链接
- **PDF 云存储** — 支持 AWS S3、MinIO、阿里云 OSS，自动生成签名下载链接
- **阅读追踪** — 标记论文已读/未读，查看带时间戳的阅读历史
- **标签系统** — 自动推荐和手动标签，彩色徽章显示
- **全文搜索** — 按标题、标签、笔记内容和正文检索

### AI 深度阅读
- **多轮分析流水线**自动生成结构化笔记：
  - 第1轮：鸟瞰扫描（结构、关键页面、元数据提取）
  - 第2轮：内容理解（方法、结果、ASCII 图表复现关键图片）
  - 第3轮：深度分析（数学框架、架构图、算法细节）
- **多种 AI 引擎**：Gemini CLI、Google Gemini API、Claude Code CLI、Codex CLI
- **多种阅读模式**：vanilla（英文概要）、auto_reader（中文三轮深读）、auto_reader_v2（SVG 图表渲染）、auto_reader_v3（面向实现的分析）
- **丰富的渲染**：Mermaid 图表、KaTeX 公式、Markdown 格式

### 论文追踪
- **Semantic Scholar** — 订阅作者 ID 或关键词查询，每日推送新论文
- **Google Scholar** — 通过 OAuth 关联 Gmail，自动解析学术快讯邮件中的 arXiv 论文
- **Twitter/X** — 监控研究者账号的论文推文（基于 Playwright，实验性）
- **RSS 订阅** — 支持任意 RSS 源
- **管理界面** — 配置来源、抓取间隔，查看聚合信息流

### ARIS 自主研究工作流
- **项目模型** — 关联本地工作区，定义 SSH 部署目标及远程路径
- **研究任务** — 在远程服务器上执行自主研究（文献综述、实验监控、论文写作、完整流水线、自定义 prompt）
- **实时监控** — 运行状态、日志流、工作区文件浏览、后续操作
- **远程 Claude Code** — 在注册的 SSH 服务器上通过 git worktree 隔离执行
- **VS Code 伴侣** — 在编辑器内管理项目、ARIS 任务和论文库

### Chrome 扩展
- **自动识别** arXiv、OpenReview、Semantic Scholar 和通用 PDF 页面
- **一键保存**，自动填充元数据（标题、作者、arXiv ID、代码链接）
- **可配置** 服务器地址、分析引擎、标签和文档类型

### 导出与集成
- **Obsidian 导出** — 将笔记导出为 Markdown 文件，兼容 Obsidian 知识库
- **MCP 服务器** — 将论文库作为 MCP 工具暴露给 Claude Code 和其他 AI Agent
- **VS Code 扩展** — 在编辑器中浏览论文、启动 ARIS 任务、查看笔记

### SSH 服务器管理
- 注册远程计算节点，支持密码或密钥认证、跳板机
- 作为 ARIS 部署目标，将繁重 AI 任务卸载到远程执行
- 基于 WebSocket 的终端代理，支持浏览器内 SSH 访问

## 架构

安装脚本支持选择部署模式：

- **一体化部署** — 后端、前端和 AI 均运行在同一台机器上
- **代理 + 本地设备** — 低配云服务器通过 [FRP](https://github.com/fatedier/frp) 反向代理，将流量转发至运行所有服务的本地设备

```
# 代理 + 本地设备模式
┌──────────┐     ┌───────────────────────┐     ┌──────────────────────────┐
│   用户    │────>│  云服务器（代理）        │────>│  本地设备（WSL/PC）        │
│          │     │  nginx + frps          │     │  PM2: API + 前端          │
└──────────┘     └───────────────────────┘     │  SQLite/Turso, S3        │
                                                └──────────────────────────┘
```

代理模式下，所有繁重的 AI 任务（Claude Code CLI、Gemini CLI）在你自己的硬件上运行，无需云 GPU 费用。详见[安装模式](INSTALLATION_MODES.md)。

## 快速开始

### 前置要求

- Node.js >= 20.0.0
- npm
- 至少一个 AI CLI：[Gemini CLI](https://github.com/google-gemini/gemini-cli)、[Claude Code](https://docs.anthropic.com/en/docs/claude-code) 或 [Codex CLI](https://github.com/openai/codex)
- 对象存储账号（AWS S3、MinIO 或阿里云 OSS）

### 1. 克隆仓库

```bash
git clone https://github.com/CurryTang/Amadeus.git
cd Amadeus
```

### 2. 运行交互式安装器

安装器引导你选择部署模式并生成所有配置文件。

```bash
./scripts/install.sh
```

生成文件：
- `backend/.env.generated` — 后端配置（数据库、存储、认证、AI 引擎）
- `frontend/.env.generated` — 前端配置（API 地址）
- `deployment.mode.generated` — 部署拓扑

### 3. 应用并检查配置

```bash
cp backend/.env.generated backend/.env
cp frontend/.env.generated frontend/.env
```

打开 `backend/.env` 配置以下关键部分：

**数据库**（元数据存储）：
```bash
# 本地 SQLite（最简单，无需额外配置）
TURSO_DATABASE_URL=file:./local.db

# 或 Turso 云端（托管 libSQL）
# TURSO_DATABASE_URL=libsql://你的数据库.turso.io
# TURSO_AUTH_TOKEN=你的令牌
```

**对象存储**（PDF 文件）：
```bash
OBJECT_STORAGE_PROVIDER=aws-s3    # aws-s3 | minio | aliyun-oss
OBJECT_STORAGE_BUCKET=你的存储桶
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_ACCESS_KEY_ID=你的密钥ID
OBJECT_STORAGE_SECRET_ACCESS_KEY=你的密钥
```

MinIO 自托管（免费）：
```bash
OBJECT_STORAGE_PROVIDER=minio
OBJECT_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJECT_STORAGE_FORCE_PATH_STYLE=true
```

**认证**：
```bash
AUTH_ENABLED=true
ADMIN_TOKEN=你的管理员令牌
JWT_SECRET=随机64位十六进制字符串
```

**AI 引擎**（至少配置一个）：
```bash
GEMINI_API_KEY=你的gemini密钥         # Gemini API 模式
# 或全局安装 Gemini/Claude/Codex CLI — CLI 已配置则无需填写 key
```

详见[配置指南](CONFIGURATION.md)。

### 4. 启动后端

```bash
cd backend
npm install
npm run dev     # 开发模式（热重载）
# npm start     # 生产模式
```

### 5. 启动前端

```bash
cd frontend
npm install
npm run dev     # 开发模式，访问 http://localhost:3000
# npm run build && npm start  # 生产模式（standalone）
```

### 6. 安装 Chrome 扩展

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角**开发者模式**
3. 点击**加载已解压的扩展程序**，选择 `chrome-extension/` 文件夹
4. 点击扩展图标 → 设置 → 填写服务器地址（如 `http://localhost:3000`）
5. 访问任意 arXiv 论文页面，点击 **Save arXiv PDF**

### 7. （可选）VS Code 扩展

```bash
cd vscode-extension
npm install && npm run compile
```

在 VS Code 中按 `F5` 启动扩展开发宿主。详见 [VS Code 伴侣文档](../vscode-extension/README.md)。

## 工作原理

### 论文处理流程

```
保存（Chrome 扩展）
  → 排队（带优先级的处理队列）
    → 第1轮：鸟瞰扫描（元数据、结构）
      → 第2轮：内容理解（方法、结果、图表复现）
        → 第3轮：深度分析（数学、架构、算法）
          → 存储（Markdown 笔记上传至 S3）
            → 查看（渲染图表 + 公式）
```

### 追踪器流程

```
配置来源（Semantic Scholar / Gmail / Twitter / RSS）
  → 每日抓取（自动或手动触发）
    → 与现有论文库去重
      → 在信息流中展示新论文
        → 一键保存到论文库
```

### ARIS 研究工作流

```
定义项目（关联本地工作区）
  → 添加目标（SSH 服务器 + 远程路径）
    → 启动任务（工作流 + prompt）
      → Agent 在远程执行（git worktree 隔离）
        → 实时监控日志与状态
          → 审查输出，发送后续指令
```

## 文档

- [配置指南](CONFIGURATION.md) — 所有环境变量和选项
- [安装模式](INSTALLATION_MODES.md) — 部署拓扑与提供商矩阵
- [部署指南](DEPLOYMENT_CN.md) — 生产环境部署步骤
- [DO + FRP + Tailscale](DO_FRP_TAILSCALE.md) — 代理 + FRP + VPN 配置
- [FRP 配置指南](FRP_SETUP_GUIDE.md) — 详细 FRP 配置
- [S3 配置指南](S3_SETUP_GUIDE.md) — 对象存储配置（S3/MinIO/OSS）
- [Tracker 认证指南](TRACKER_AUTH.md) — Google Scholar 和 Twitter/X 追踪器认证
- [VS Code 伴侣](../vscode-extension/README.md) — VS Code 扩展配置

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18、Next.js（standalone）、React Markdown、KaTeX、Mermaid |
| **后端** | Node.js、Express、WebSocket（终端代理） |
| **数据库** | Turso (libSQL) / 本地 SQLite |
| **存储** | AWS S3 / MinIO / 阿里云 OSS |
| **AI** | Claude Code CLI、Gemini CLI、Codex CLI、Google Gemini API |
| **基础设施** | PM2、FRP（反向代理）、nginx |
| **扩展** | Chrome Manifest V3、VS Code Extension API |

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 许可证

MIT 许可证 — 详见 [LICENSE](../LICENSE)。
