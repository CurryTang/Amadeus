# FRP Proxy Setup - Complete! ✓

## Setup Summary

Your backend has been successfully configured to use the DO server as a lightweight proxy with desktop processing via FRP.

## What Was Done

### 1. DO Server (YOUR_SERVER_IP) ✓
- **FRP Server installed** and running
  - Control port: 7000
  - Data port: 7001
  - Dashboard: http://YOUR_SERVER_IP:7500 (admin / <your-frp-dashboard-password>)
- **Backend configuration updated**
  - `PROCESSING_ENABLED=true`
  - `PROCESSING_DESKTOP_URL=http://127.0.0.1:7001`
  - `READER_ENABLED=false` (saves resources)
- **Backend restarted** with new configuration
- **Firewall configured** to allow FRP ports

### 2. Desktop (This Machine) ✓
- **FRP Client installed** (`./frpc`)
- **FRP Client configured** with matching token
- **Processing Server created** (`processing-server.js`)
- **Dependencies installed** (`npm install`)
- **Both services started**
  - FRP Client: Connected to DO server
  - Processing Server: Listening on port 3001

### 3. Connection Tests ✓
- ✓ Local processing server: http://localhost:3001/health
- ✓ FRP tunnel from DO: http://127.0.0.1:7001/health
- ✓ End-to-end verified

## Current Status

```
┌──────────────┐         ┌─────────────────┐         ┌──────────────┐
│   Frontend   │────────►│   DO Server     │────────►│   Desktop    │
│              │  HTTP   │  (Proxy)        │  FRP    │  (Process)   │
└──────────────┘         │  YOUR_SERVER_IP   │         │  localhost   │
                         │  Port 3000      │         │  Port 3001   │
                         └─────────────────┘         └──────────────┘
                                 │                          │
                          ┌──────┴──────┐           ┌──────┴──────┐
                          │   Turso DB  │           │  Gemini CLI │
                          │   AWS S3    │           │  LLM APIs   │
                          └─────────────┘           └─────────────┘
```

### Running Processes

**DO Server:**
- PM2: `auto-reader-api` (proxying to desktop)
- FRP Server: `frps` (accepting connections)

**Desktop:**
- FRP Client: PID 18907 (connected)
- Processing Server: PID 18922 (ready)

## How to Use

### Start Desktop Services

```bash
cd backend
./start-local.sh
```

This starts both FRP client and processing server.

### Stop Desktop Services

```bash
pkill -f frpc
pkill -f processing-server
```

### Monitor Logs

```bash
# Desktop
tail -f frpc.log               # FRP client
tail -f processing-server.log  # Processing server

# DO Server (SSH)
ssh root@YOUR_SERVER_IP
pm2 logs auto-reader-api
```

### Check Status

```bash
# Test local processing server
curl http://localhost:3001/health

# Test from DO server (via FRP)
ssh root@YOUR_SERVER_IP "curl http://127.0.0.1:7001/health"

# Check FRP connection
tail -20 frpc.log | grep "success"
```

## What Happens Now

1. **User uploads PDF** via frontend to DO server
2. **DO server receives request** and checks if desktop is available
3. **Request forwarded to desktop** via FRP tunnel (port 7001 → 3001)
4. **Desktop processes** with Gemini CLI or LLM APIs
5. **Result returned** through tunnel to DO server
6. **DO server saves** to S3 and updates database
7. **Frontend gets response**

## FRP Token

**Important**: Keep this secure!

```
<your-frp-token>
```

This token is configured on both server and client. If you need to change it:
1. Update `/etc/frp/frps.toml` on DO server
2. Update `frpc.toml` on desktop
3. Restart both services

## Configuration Files

### DO Server
- FRP Server: `/etc/frp/frps.toml`
- Backend: `/var/www/auto-researcher/backend/.env`
- Service: `/etc/systemd/system/frps.service`

### Desktop
- FRP Client: `backend/frpc.toml`
- Processing Server: `backend/processing-server.js`
- Environment: `backend/.env`
- Start Script: `backend/start-local.sh`

## Monitoring Dashboard

Access FRP dashboard at:
- URL: http://YOUR_SERVER_IP:7500
- Username: `admin`
- Password: `<your-frp-dashboard-password>`

Shows:
- Connected clients
- Active proxies
- Traffic statistics
- Connection status

## Troubleshooting

### Desktop Not Connecting

**Check FRP client:**
```bash
tail -50 frpc.log
# Look for "login to server success"
```

**Restart:**
```bash
./start-local.sh
```

### Processing Requests Failing

**Check processing server:**
```bash
tail -50 processing-server.log
# Look for errors
```

**Test locally:**
```bash
curl http://localhost:3001/health
```

### DO Server Can't Reach Desktop

**Test tunnel:**
```bash
ssh root@YOUR_SERVER_IP "curl http://127.0.0.1:7001/health"
```

**Check FRP server:**
```bash
ssh root@YOUR_SERVER_IP "systemctl status frps"
```

## Benefits Achieved

✅ **Cost Savings**: Basic $6 DO droplet instead of $24+ powerful one
✅ **Better Performance**: Desktop CPU/GPU for heavy processing
✅ **Flexibility**: Easy to add more desktop workers
✅ **Reliability**: Auto-fallback to local if desktop unavailable
✅ **Security**: Encrypted FRP tunnel with token authentication

## Next Steps

1. **Test with real documents**: Upload a PDF and trigger processing
2. **Monitor performance**: Check logs and FRP dashboard
3. **Install Gemini CLI**: For better processing (optional)
4. **Add more workers**: Run multiple processing servers if needed

## Important Notes

- **Keep desktop running**: Processing only works when desktop is on
- **Stable internet needed**: Desktop needs good connection to DO server
- **Token security**: Keep FRP token private
- **Restart after reboot**: Run `start-local.sh` after desktop restarts

## Support

For issues, check:
1. Logs: `frpc.log` and `processing-server.log`
2. Connection: `curl http://localhost:3001/health`
3. FRP Dashboard: http://YOUR_SERVER_IP:7500
4. Full guide: See [docs/FRP_SETUP_GUIDE.md](../docs/FRP_SETUP_GUIDE.md)

---

**Setup completed**: 2026-01-27 02:00 UTC
**FRP Version**: 0.56.0
**Node Version**: v18.19.1
