#!/bin/bash

# Auto Reader Deployment Script
# Usage: ./scripts/deploy.sh [setup|deploy|restart|logs|status]

set -e

# Configuration
REMOTE_HOST="${DO_SERVER_IP:?Set DO_SERVER_IP env var to your server IP}"
REMOTE_USER="root"  # Change to your SSH user
REMOTE_DIR="/var/www/auto-researcher"
REPO_URL="https://github.com/CurryTang/auto-researcher.git"
BRANCH="master"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# SSH command helper
ssh_cmd() {
    ssh -o StrictHostKeyChecking=no "${REMOTE_USER}@${REMOTE_HOST}" "$1"
}

# First-time server setup
setup() {
    log_info "Setting up server for first-time deployment..."

    ssh_cmd "
        # Update system
        apt-get update && apt-get upgrade -y

        # Install Node.js 20.x
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs

        # Install PM2 globally
        npm install -g pm2

        # Install git if not present
        apt-get install -y git

        # Create app directory
        mkdir -p ${REMOTE_DIR}
        mkdir -p /var/log/pm2

        # Clone repository
        if [ ! -d '${REMOTE_DIR}/.git' ]; then
            git clone ${REPO_URL} ${REMOTE_DIR}
        fi

        echo 'Server setup complete!'
    "

    log_info "Server setup complete!"
    log_warn "Don't forget to:"
    echo "  1. Copy your .env file to ${REMOTE_DIR}/backend/.env"
    echo "  2. Run './scripts/deploy.sh deploy' to deploy the app"
}

# Deploy latest code
deploy() {
    log_info "Deploying to ${REMOTE_HOST}..."

    ssh_cmd "
        cd ${REMOTE_DIR}

        # Pull latest code
        echo 'Pulling latest code from GitHub...'
        git fetch origin
        git reset --hard origin/${BRANCH}

        # Install backend dependencies
        echo 'Installing backend dependencies...'
        cd backend
        npm ci --production

        # Restart PM2 process
        echo 'Restarting PM2 process...'
        pm2 stop auto-reader-api 2>/dev/null || true
        pm2 delete auto-reader-api 2>/dev/null || true
        pm2 start ecosystem.config.js --env production
        pm2 save

        # Setup PM2 startup (run once)
        pm2 startup systemd -u ${REMOTE_USER} --hp /root 2>/dev/null || true

        echo 'Deployment complete!'
    "

    log_info "Deployment complete!"
    log_info "Backend running at http://${REMOTE_HOST}:3000"
}

# Quick deploy: backend only (git pull + npm ci + pm2 restart)
# NOTE: Never build frontend remotely — DO server has ~1GB RAM, no swap.
# Use the deploy-frontend skill to build locally and rsync dist/ instead.
quick_deploy() {
    log_info "Quick deploying to ${REMOTE_HOST}..."

    ssh_cmd "
        cd ${REMOTE_DIR}
        git pull origin ${BRANCH}
        cd backend
        npm ci --production
        pm2 restart auto-reader-api
    "

    log_info "Quick deploy complete!"
}

# Restart the application
restart() {
    log_info "Restarting application..."
    ssh_cmd "pm2 restart auto-reader-api"
    log_info "Application restarted!"
}

# Stop the application
stop() {
    log_info "Stopping application..."
    ssh_cmd "pm2 stop auto-reader-api"
    log_info "Application stopped!"
}

# View logs
logs() {
    log_info "Fetching logs..."
    ssh_cmd "pm2 logs auto-reader-api --lines 50"
}

# View status
status() {
    log_info "Checking application status..."
    ssh_cmd "pm2 status"
}

# Copy .env file to server
copy_env() {
    if [ ! -f "backend/.env" ]; then
        log_error "backend/.env file not found!"
        exit 1
    fi

    log_info "Copying .env file to server..."
    scp backend/.env "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}/backend/.env"
    log_info ".env file copied!"
}

# Health check
health() {
    log_info "Checking API health..."
    response=$(curl -s "http://${REMOTE_HOST}:3000/api/health" || echo "failed")
    if [[ "$response" == *"ok"* ]]; then
        log_info "API is healthy!"
        echo "$response" | python3 -m json.tool 2>/dev/null || echo "$response"
    else
        log_error "API health check failed!"
        echo "$response"
    fi
}

# Show usage
usage() {
    echo "Auto Reader Deployment Script"
    echo ""
    echo "Usage: $0 <command>"
    echo ""
    echo "Commands:"
    echo "  setup       First-time server setup (install Node.js, PM2, clone repo)"
    echo "  deploy      Full deployment (pull, install deps, restart)"
    echo "  quick       Quick deploy (pull and restart)"
    echo "  restart     Restart the application"
    echo "  stop        Stop the application"
    echo "  logs        View application logs"
    echo "  status      View PM2 status"
    echo "  copy-env    Copy local .env to server"
    echo "  health      Check API health"
    echo ""
    echo "Example:"
    echo "  $0 setup      # First time setup"
    echo "  $0 copy-env   # Copy .env file"
    echo "  $0 deploy     # Deploy the app"
}

# Main
case "${1}" in
    setup)
        setup
        ;;
    deploy)
        deploy
        ;;
    quick)
        quick_deploy
        ;;
    restart)
        restart
        ;;
    stop)
        stop
        ;;
    logs)
        logs
        ;;
    status)
        status
        ;;
    copy-env)
        copy_env
        ;;
    health)
        health
        ;;
    *)
        usage
        exit 1
        ;;
esac
