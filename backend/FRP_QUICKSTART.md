# FRP Proxy Quick Start

This is a quick reference for setting up the DO server as a proxy with desktop processing.

## TL;DR

**On DO Server:**
```bash
# 1. Install FRP server
./scripts/setup-frp.sh  # Choose option 1

# 2. Update .env
cp .env.server.example .env
# Edit .env with your settings

# 3. Restart backend
pm2 restart all
```

**On Desktop:**
```bash
# 1. Install FRP client
./scripts/setup-frp.sh  # Choose option 2

# 2. Setup environment
cp .env.desktop.example .env
# Edit .env with your API keys

# 3. Start services
npm install
./scripts/start-desktop.sh
```

That's it! Your DO server will now forward all LLM processing to your desktop.

## What Gets Proxied?

✅ Document processing (PDF to notes)
✅ Code analysis
✅ LLM API calls
✅ Gemini CLI operations

## What Stays on DO Server?

✅ Database operations (Turso)
✅ S3 uploads/downloads
✅ API routing
✅ Rate limiting
✅ Authentication

## Architecture

```
Frontend → DO Server (proxy) → FRP Tunnel → Desktop (processing)
              ↓
           Turso DB
           AWS S3
```

## Ports

- **DO Server:**
  - 3000: Main API
  - 7000: FRP control
  - 7001: FRP data (proxied to desktop)
  - 7500: FRP dashboard (optional)

- **Desktop:**
  - 3001: Processing server (local only)

## Testing

### Check FRP Connection
```bash
# On DO server
curl http://127.0.0.1:7001/health

# Should return JSON with "status": "ok"
```

### Check Processing
```bash
# Upload a PDF via frontend and request processing
# Check logs:

# DO server (should show forwarding):
pm2 logs | grep "Forwarding to desktop"

# Desktop (should show processing):
tail -f processing-server.log
```

## Troubleshooting

### "Desktop processing service is not available"

1. Check FRP client is running on desktop:
   ```bash
   ps aux | grep frpc
   ```

2. Check processing server is running:
   ```bash
   ps aux | grep processing-server
   ```

3. Check FRP connection:
   ```bash
   tail -f frpc.log
   # Look for "login to server success"
   ```

### Restart Everything

**Desktop:**
```bash
pkill -f frpc
pkill -f processing-server
./scripts/start-desktop.sh
```

**DO Server:**
```bash
sudo systemctl restart frps
pm2 restart all
```

## Monitoring

**FRP Dashboard:** http://YOUR_DO_SERVER_IP:7500

**Logs:**
```bash
# DO server
pm2 logs

# Desktop
tail -f frpc.log
tail -f processing-server.log
```

## Benefits

💰 **Cost**: Basic DO droplet ($6/mo) instead of powerful one ($24+/mo)
⚡ **Performance**: Use desktop's GPU/CPU
🔒 **Security**: Encrypted FRP tunnel
🔄 **Fallback**: Auto-fallback to local if desktop unavailable
📈 **Scalable**: Easy to add more desktop workers

## Full Documentation

See [docs/FRP_SETUP_GUIDE.md](../docs/FRP_SETUP_GUIDE.md) for:
- Detailed setup instructions
- Security considerations
- Performance tuning
- Advanced configurations
- Troubleshooting guide

## Questions?

1. Read the full guide: `docs/FRP_SETUP_GUIDE.md`
2. Check logs: Both DO and desktop
3. Test FRP connection: `curl http://127.0.0.1:7001/health`
4. Verify config: Token must match on both sides
