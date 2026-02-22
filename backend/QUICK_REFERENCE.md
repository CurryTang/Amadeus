# FRP Proxy - Quick Reference

## Start Desktop Services
```bash
cd backend
./start-local.sh
```

## Stop Desktop Services
```bash
pkill -f frpc
pkill -f processing-server
```

## Check Status
```bash
# Desktop
curl http://localhost:3001/health

# From DO
ssh root@YOUR_SERVER_IP "curl http://127.0.0.1:7001/health"

# FRP connection
tail -20 frpc.log | grep "login to server success"
```

## View Logs
```bash
# Desktop
tail -f frpc.log
tail -f processing-server.log

# DO Server
ssh root@YOUR_SERVER_IP
pm2 logs auto-reader-api
sudo journalctl -u frps -f
```

## FRP Dashboard
- URL: http://YOUR_SERVER_IP:7500
- User: `admin`
- Pass: `<your-frp-dashboard-password>`

## Restart Services

### Desktop
```bash
./start-local.sh
```

### DO Server
```bash
ssh root@YOUR_SERVER_IP
sudo systemctl restart frps
pm2 restart auto-reader-api
```

## Configuration

**DO Server:**
- Backend: `/var/www/auto-researcher/backend/.env`
- FRP: `/etc/frp/frps.toml`

**Desktop:**
- Backend: `backend/.env`
- FRP: `backend/frpc.toml`

## Ports

**DO Server:**
- 3000: Backend API
- 7000: FRP control
- 7001: FRP data (proxied to desktop)
- 7500: FRP dashboard

**Desktop:**
- 3001: Processing server (local only)

## Architecture
```
Frontend → DO:3000 → FRP:7001 → Desktop:3001 → Process → Return
```

## Token
```
<your-frp-token>
```

## Common Issues

**Desktop not connecting:**
1. Check frpc.log for errors
2. Verify token matches
3. Restart: `./start-local.sh`

**Processing failing:**
1. Check processing-server.log
2. Test: `curl http://localhost:3001/health`
3. Check .env file has credentials

**DO can't reach desktop:**
1. Test: `ssh root@YOUR_SERVER_IP "curl http://127.0.0.1:7001/health"`
2. Check FRP: `ssh root@YOUR_SERVER_IP "systemctl status frps"`
3. Check firewall

## Files Reference

### Desktop
- `frpc` - FRP client binary
- `frpc.toml` - FRP client config
- `processing-server.js` - Processing server
- `start-local.sh` - Start script
- `frpc.log` - FRP client logs
- `processing-server.log` - Processing logs

### DO Server
- `/usr/local/bin/frps` - FRP server binary
- `/etc/frp/frps.toml` - FRP server config
- `/etc/systemd/system/frps.service` - Systemd service
- `/var/log/frp/frps.log` - FRP server logs
