# Deployment Guide

This guide covers deploying Auto Reader to production.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│   Backend API   │────▶│   AWS S3        │
│  (GitHub Pages) │     │  (VPS/Server)   │     │  (File Storage) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │   Turso DB      │
                        │  (SQLite Cloud) │
                        └─────────────────┘
```

## Prerequisites

- Node.js 20.x or later
- Git
- A VPS or cloud server (DigitalOcean, AWS EC2, etc.)
- AWS S3 bucket for file storage
- Turso database account (free tier available)
- Domain name (optional but recommended)

## Backend Deployment

### Option 1: Using the Deploy Script

The project includes a deployment script at `scripts/deploy.sh`.

```bash
# First-time setup
./scripts/deploy.sh setup

# Copy environment file
./scripts/deploy.sh copy-env

# Deploy
./scripts/deploy.sh deploy
```

### Option 2: Manual Deployment

1. **SSH into your server:**
   ```bash
   ssh user@your-server-ip
   ```

2. **Install Node.js:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

3. **Install PM2:**
   ```bash
   sudo npm install -g pm2
   ```

4. **Clone the repository:**
   ```bash
   git clone https://github.com/CurryTang/auto-researcher.git
   cd auto-researcher/backend
   ```

5. **Install dependencies:**
   ```bash
   npm ci --production
   ```

6. **Create environment file:**
   ```bash
   cp .env.example .env
   nano .env  # Edit with your credentials
   ```

7. **Start with PM2:**
   ```bash
   pm2 start ecosystem.config.js --env production
   pm2 save
   pm2 startup
   ```

### Nginx Reverse Proxy (Recommended)

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

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

### SSL with Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d api.yourdomain.com
```

## Frontend Deployment

The frontend is deployed to GitHub Pages automatically.

### Manual Deployment

```bash
cd frontend
npm install
npm run build
npx gh-pages -d dist
```

### Configuration

Update the API URL in `frontend/src/App.jsx`:

```javascript
const API_URL = 'https://api.yourdomain.com/api';
```

Also update `vite.config.js` base path:

```javascript
base: '/your-repo-name/',
```

## Chrome Extension

The Chrome extension needs to be configured with your API URL:

1. Open `extension/background.js`
2. Update the API endpoint:
   ```javascript
   const API_BASE = 'https://api.yourdomain.com/api';
   ```
3. Load as unpacked extension in Chrome

## Database Setup

### Turso (Recommended)

1. Create account at [turso.tech](https://turso.tech)
2. Create a new database
3. Get your database URL and auth token
4. Add to `.env`:
   ```
   TURSO_DATABASE_URL=libsql://your-db.turso.io
   TURSO_AUTH_TOKEN=your-token
   ```

### Local SQLite (Development)

```
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=
```

## AWS S3 Setup

See [S3_SETUP_GUIDE.md](./S3_SETUP_GUIDE.md) for detailed instructions.

Quick setup:
1. Create S3 bucket
2. Create IAM user with S3 permissions
3. Add credentials to `.env`:
   ```
   AWS_ACCESS_KEY_ID=your-key
   AWS_SECRET_ACCESS_KEY=your-secret
   AWS_REGION=us-east-1
   AWS_S3_BUCKET=your-bucket-name
   ```

## Gemini CLI Setup (Required for Paper Analysis)

The paper analysis feature uses Google's Gemini CLI.

1. Install Gemini CLI:
   ```bash
   npm install -g @google/gemini-cli
   ```

2. Authenticate:
   ```bash
   gemini auth
   ```

3. Verify installation:
   ```bash
   gemini -v
   ```

## Health Checks

After deployment, verify everything works:

```bash
# Check API health
curl https://api.yourdomain.com/api/health

# Check PM2 status
pm2 status

# View logs
pm2 logs auto-reader-api
```

## Updating

```bash
# Quick update (pull and restart)
./scripts/deploy.sh quick

# Full redeploy
./scripts/deploy.sh deploy
```

## Troubleshooting

### Backend won't start

Check logs:
```bash
pm2 logs auto-reader-api --lines 50
```

Common issues:
- Missing environment variables
- Database connection failed
- Port already in use

### Frontend shows blank page

- Check browser console for errors
- Verify API URL is correct
- Clear browser cache

### Paper analysis not working

- Verify Gemini CLI is installed: `gemini -v`
- Check Gemini authentication: `gemini auth`
- Check server logs for errors
