# FRP Proxy Setup Guide

This guide explains how to configure the backend to use your DO server as a lightweight proxy while doing all heavy LLM processing on your desktop.

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│             │  HTTP   │              │  FRP    │             │
│  Frontend   ├────────►│  DO Server   ├────────►│   Desktop   │
│             │         │  (Proxy)     │  Tunnel │ (Processing)│
└─────────────┘         └──────────────┘         └─────────────┘
                               │                         │
                               │                         │
                               ▼                         ▼
                        ┌──────────────┐         ┌──────────────┐
                        │    Turso DB  │         │  Gemini CLI  │
                        │    AWS S3    │         │  LLM Models  │
                        └──────────────┘         └──────────────┘
```

### Components

1. **DO Server (YOUR_SERVER_IP)**
   - Main Express backend (port 3000)
   - FRP Server (port 7000)
   - Handles: Database, S3, routing, rate limiting
   - Does NOT handle: LLM processing, PDF analysis, code analysis

2. **Desktop (Your Local Machine)**
   - FRP Client (connects to DO server)
   - Processing Server (port 3001)
   - Handles: All LLM processing, Gemini CLI, code analysis

3. **FRP Tunnel**
   - Secure TCP tunnel between DO server and desktop
   - Forwards port 7001 on DO server to port 3001 on desktop
   - Encrypted communication

## Prerequisites

### On DO Server
- Node.js 18+ installed
- Backend deployed
- Ports 3000, 7000, 7001, 7500 open in firewall

### On Desktop
- Node.js 18+ installed
- Gemini CLI installed
- LLM API keys configured
- Stable internet connection
- Git installed (for code analysis)

## Installation Steps

### Step 1: Install FRP

We've provided an automated script to install FRP:

```bash
cd backend
./scripts/setup-frp.sh
```

Follow the prompts to install either:
- **Option 1**: FRP Server (for DO server)
- **Option 2**: FRP Client (for desktop)

Or manually download from: https://github.com/fatedier/frp/releases

### Step 2: Configure DO Server

#### 2.1 Update .env file

Add to your DO server's `.env`:

```bash
# Enable processing proxy
PROCESSING_ENABLED=true
PROCESSING_DESKTOP_URL=http://127.0.0.1:7001
PROCESSING_TIMEOUT=300000

# Optional: Disable local reader to save resources
READER_ENABLED=false
```

#### 2.2 Configure FRP Server

Edit `/etc/frp/frps.toml`:

```toml
bindPort = 7000

auth.method = "token"
auth.token = "YOUR_SECURE_TOKEN_HERE"  # Change this!

webServer.addr = "0.0.0.0"
webServer.port = 7500
webServer.user = "admin"
webServer.password = "YOUR_DASHBOARD_PASSWORD"  # Change this!

log.to = "/var/log/frp/frps.log"
log.level = "info"
```

#### 2.3 Start FRP Server

```bash
sudo systemctl start frps
sudo systemctl enable frps
sudo systemctl status frps
```

#### 2.4 Update Firewall

```bash
# Allow FRP control port
sudo ufw allow 7000/tcp

# Allow FRP dashboard (optional, for monitoring)
sudo ufw allow 7500/tcp

# Allow FRP data port
sudo ufw allow 7001/tcp
```

### Step 3: Configure Desktop

#### 3.1 Setup Environment

Create `.env` in backend directory:

```bash
# Copy from DO server
TURSO_DATABASE_URL=your_turso_url
TURSO_AUTH_TOKEN=your_turso_token
AWS_ACCESS_KEY_ID=your_aws_key
AWS_SECRET_ACCESS_KEY=your_aws_secret
AWS_REGION=us-east-1
AWS_S3_BUCKET=auto-reader-documents

# LLM API Keys (configure at least one)
GEMINI_API_KEY=your_gemini_key
ANTHROPIC_API_KEY=your_anthropic_key

# Mathpix (for large PDFs)
MATHPIX_APP_ID=your_app_id
MATHPIX_APP_KEY=your_app_key

# Processing server port
PROCESSING_PORT=3001
```

#### 3.2 Configure FRP Client

Edit `backend/frpc-local.toml`:

```toml
serverAddr = "YOUR_SERVER_IP"  # Your DO server IP
serverPort = 7000

auth.method = "token"
auth.token = "YOUR_SECURE_TOKEN_HERE"  # MUST match server!

[[proxies]]
name = "llm-processing"
type = "tcp"
localIP = "127.0.0.1"
localPort = 3001
remotePort = 7001
```

#### 3.3 Install Dependencies

```bash
cd backend
npm install
```

### Step 4: Start Services

#### On Desktop (start in this order):

1. **Start FRP Client**
   ```bash
   cd backend
   frpc -c frpc-local.toml
   ```

   You should see: "login to server success"

2. **Start Processing Server**
   ```bash
   cd backend
   node processing-server.js
   ```

   You should see: "Desktop Processing Server running on port 3001"

#### On DO Server:

3. **Restart Backend**
   ```bash
   cd backend
   pm2 restart all
   ```

### Step 5: Verify Setup

#### Check FRP Connection

```bash
# On DO server - check FRP logs
sudo journalctl -u frps -f

# On desktop - check FRP client logs
tail -f frpc.log
```

#### Check Processing Connection

```bash
# On DO server - test connection to desktop
curl http://127.0.0.1:7001/health

# Should return:
# {"status":"ok","service":"Desktop Processing Server",...}
```

#### Test End-to-End

1. Upload a PDF document via frontend
2. Request processing
3. Check logs:
   - DO server should log: "Forwarding to desktop for processing"
   - Desktop should log: "Document request: ..."

## Monitoring

### FRP Dashboard

Access at: `http://YOUR_DO_SERVER_IP:7500`

- Username: admin
- Password: (what you set in config)

Shows:
- Connected clients
- Active proxies
- Traffic statistics

### Application Logs

**DO Server:**
```bash
pm2 logs
```

**Desktop:**
```bash
# FRP client
tail -f frpc.log

# Processing server
tail -f processing-server.log
```

## Troubleshooting

### Desktop Not Connecting

**Symptom:** DO server can't reach desktop

**Check:**
1. FRP client running on desktop?
   ```bash
   ps aux | grep frpc
   ```

2. FRP token matches?
   - Compare `frps.toml` and `frpc-local.toml`

3. Firewall blocking port 7000?
   ```bash
   telnet YOUR_SERVER_IP 7000
   ```

### Processing Server Not Responding

**Symptom:** Requests timeout

**Check:**
1. Processing server running?
   ```bash
   ps aux | grep processing-server
   ```

2. Test local connection:
   ```bash
   curl http://localhost:3001/health
   ```

3. Gemini CLI available?
   ```bash
   which gemini
   gemini --version
   ```

### Documents Falling Back to Local Processing

**Symptom:** "Desktop processing failed, falling back to local"

**Possible causes:**
- Desktop server crashed
- FRP connection dropped
- Request timeout (default 5 minutes)

**Solutions:**
- Restart processing server
- Check FRP connection
- Increase timeout in .env: `PROCESSING_TIMEOUT=600000`

## Performance Tuning

### For Faster Processing

1. **Increase parallelism** (on desktop):
   ```bash
   # Start multiple processing servers
   PROCESSING_PORT=3001 node processing-server.js &
   PROCESSING_PORT=3002 node processing-server.js &
   ```

   Then configure multiple FRP proxies

2. **Use faster models**:
   Update `.env`:
   ```bash
   GEMINI_MODEL=gemini-1.5-flash
   ```

3. **Disable rate limiting** (if you control access):
   Update DO server `.env`:
   ```bash
   RATE_LIMIT_MAX=999999
   PAPER_ANALYSIS_MAX=999999
   ```

### For Cost Optimization

1. **Use cheaper models**:
   ```bash
   GEMINI_MODEL=gemini-1.5-flash  # Cheaper than pro
   ```

2. **Set lower page limits**:
   ```bash
   READER_MAX_PAGE_COUNT=20  # Process fewer pages
   ```

## Security Considerations

1. **Strong FRP Token**: Use a long random string
   ```bash
   openssl rand -hex 32
   ```

2. **Firewall Rules**: Only allow necessary IPs
   ```bash
   # On DO server - only allow your desktop IP
   sudo ufw allow from YOUR_DESKTOP_IP to any port 7000
   ```

3. **HTTPS for Frontend**: Use SSL certificate

4. **Rotate Tokens**: Change FRP token periodically

## Maintenance

### Update FRP

```bash
# Download new version
wget https://github.com/fatedier/frp/releases/download/vX.X.X/...

# Extract and replace binaries
sudo systemctl stop frps  # or stop frpc
sudo cp frps /usr/local/bin/
sudo systemctl start frps
```

### Backup Configuration

```bash
# On DO server
sudo cp /etc/frp/frps.toml /backup/

# On desktop
cp frpc-local.toml /backup/
```

## Alternative: Running Desktop Server as Daemon

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start processing server
pm2 start processing-server.js --name "desktop-processing"

# Start FRP client
pm2 start "frpc -c frpc-local.toml" --name "frp-client"

# Save configuration
pm2 save
pm2 startup
```

### Using systemd

Create `/etc/systemd/system/processing-server.service`:

```ini
[Unit]
Description=Desktop Processing Server
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/path/to/backend
ExecStart=/usr/bin/node processing-server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable processing-server
sudo systemctl start processing-server
```

## Cost Comparison

### Before (All on DO Server)
- 1 CPU droplet: Struggles with LLM processing
- Frequent timeouts
- Need to upgrade: $24+/month

### After (Proxy Setup)
- Basic DO droplet: $6/month (just proxy)
- Desktop: Free (you already have it)
- Better performance with desktop GPU/CPU
- Pay only for API calls

## Questions?

- Check logs first: Both DO server and desktop
- Verify FRP connection: Dashboard at port 7500
- Test independently: `curl http://127.0.0.1:7001/health`

## Summary

✅ DO Server: Lightweight proxy ($6/month)
✅ Desktop: Heavy processing (free)
✅ FRP: Secure tunnel between them
✅ Fallback: Local processing if desktop unavailable
✅ Scalable: Add more desktop workers as needed
