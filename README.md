# Auto Reader

Your personal AI research assistant that automatically reads, summarizes, and organizes academic papers.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)

**[English](#english-version) | [中文文档](docs/README_CN.md)**

---

# English Version

## Screenshots

| Web Interface | Chrome Extension |
|:---:|:---:|
| ![Homepage](assets/demo_homepage.png) | ![Chrome Extension](assets/demo_chrome.png) |

## Features

- **One-Click Paper Saving** - Chrome extension to save papers from arXiv, OpenReview, and any PDF
- **AI-Powered Summaries** - Multi-pass deep reading generates comprehensive notes
- **Code Analysis** - Automatically analyzes associated GitHub repositories
- **Beautiful Diagrams** - Auto-generated Mermaid diagrams for architectures and workflows
- **Math Support** - Full LaTeX rendering with KaTeX
- **Read Tracking** - Mark papers as read/unread, filter your library
- **Full-Text Search** - Find papers by title, tags, and content

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/CurryTang/auto-researcher.git
cd auto-researcher
```

### 2. Set Up Backend

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your credentials (see Configuration)
npm start
```

### 3. Set Up Frontend

```bash
cd frontend
npm install
npm run dev
```

### 4. Install Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `extension/` folder

## How It Works

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Browser    │────▶│   Backend    │────▶│  Gemini AI   │
│  Extension   │     │    API       │     │   Analysis   │
└──────────────┘     └──────────────┘     └──────────────┘
       │                    │                    │
       │                    ▼                    │
       │             ┌──────────────┐            │
       │             │   Database   │            │
       │             │   (Turso)    │            │
       │             └──────────────┘            │
       │                    │                    │
       ▼                    ▼                    ▼
┌──────────────────────────────────────────────────────┐
│                    Web Interface                      │
│         View Papers, Notes, Diagrams, Code           │
└──────────────────────────────────────────────────────┘
```

### Paper Processing Pipeline

1. **Save** - Chrome extension captures paper metadata and PDF
2. **Queue** - Paper is added to processing queue
3. **Analyze** - Gemini AI performs 3-pass deep reading:
   - Pass 1: Bird's eye scan (structure, key pages)
   - Pass 2: Content understanding (methods, results)
   - Pass 3: Deep analysis (math, diagrams)
4. **Store** - Notes saved to cloud storage
5. **View** - Beautiful rendered notes with diagrams and math

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) - How to deploy to production
- [Usage Guide](docs/USAGE.md) - How to use the application
- [Configuration Guide](docs/CONFIGURATION.md) - All configuration options
- [S3 Setup Guide](docs/S3_SETUP_GUIDE.md) - AWS S3 configuration
- [Tracker Authentication Guide](docs/TRACKER_AUTH.md) - Google Scholar and Twitter/X tracker auth setup

## Tech Stack

**Frontend:**
- React 18
- Vite
- React Markdown + KaTeX + Mermaid
- GitHub Pages hosting

**Backend:**
- Node.js + Express
- Turso (SQLite cloud)
- AWS S3
- PM2 process manager

**AI:**
- Google Gemini CLI (paper analysis)
- Claude Code CLI (code analysis)

## Configuration

Key environment variables:

```bash
# Required
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=your-token
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_S3_BUCKET=your-bucket

# Authentication
ADMIN_TOKEN=your-admin-token  # For write operations

# Optional
READER_MAX_PER_HOUR=5        # Papers processed per hour
RATE_LIMIT_MAX=200           # API rate limit
```

See [Configuration Guide](docs/CONFIGURATION.md) for all options.

## Development

```bash
# Backend (with hot reload)
cd backend && npm run dev

# Frontend (with hot reload)
cd frontend && npm run dev
```

## Experimental: X/Twitter Paper Post Extractor (Playwright)

1. Install backend dependencies and Playwright browser:
```bash
cd backend
npm install
npx playwright install chromium
```

2. (Optional but recommended) provide a logged-in storage state:
```bash
X_PLAYWRIGHT_STORAGE_STATE_PATH=/absolute/path/to/x-state.json
```

3. Run extractor with profile links:
```bash
npm run exp:x-papers -- --links "https://x.com/karpathy,https://x.com/ylecun" --out ./x-paper-posts.json
```

Tracker Admin now supports Twitter source mode `Playwright (experimental)` with multiple profile links.
By default it runs daily (`crawlIntervalHours=24`), archives newly seen post URLs, and avoids re-processing archived posts on later runs.

## Deployment

Quick deploy using the included script:

```bash
./scripts/deploy.sh deploy
```

See [Deployment Guide](docs/DEPLOYMENT.md) for detailed instructions.

## Updates

### Recommended Deployment Architecture

Our DigitalOcean server is a low-cost instance ($8/month), which cannot handle multi-user scenarios well. The recommended deployment approach is to use the cloud server as a **lightweight proxy**, and then use [FRP](https://github.com/fatedier/frp) (Fast Reverse Proxy) to forward user requests to a local powerful PC for actual AI processing.

```
┌──────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│  Users   │────▶│  Cloud Server ($8)  │────▶│  Local Powerful PC   │
│          │     │  (Proxy via FRP)     │     │  (AI Processing)     │
└──────────┘     └─────────────────────┘     └──────────────────────┘
```

This way, the cloud server only handles routing and lightweight API requests, while all heavy AI workloads (Gemini CLI, Codex CLI, Claude Code) run on your local machine with better hardware.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Gemini](https://deepmind.google/technologies/gemini/) for paper analysis
- [Mermaid](https://mermaid.js.org/) for diagram rendering
- [KaTeX](https://katex.org/) for math rendering
