#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_ENV_OUT="${ROOT_DIR}/backend/.env.generated"
FRONTEND_ENV_OUT="${ROOT_DIR}/frontend/.env.generated"
PROFILE_OUT="${ROOT_DIR}/deployment.mode.generated"

mkdir -p "${ROOT_DIR}"

prompt_select() {
  local prompt="$1"
  shift
  local options=("$@")
  local count="${#options[@]}"

  echo ""
  echo "${prompt}"
  for i in "${!options[@]}"; do
    printf "  %d) %s\n" "$((i + 1))" "${options[$i]}"
  done

  local choice
  while true; do
    read -r -p "Select [1-${count}]: " choice
    if [[ "${choice}" =~ ^[0-9]+$ ]] && (( choice >= 1 && choice <= count )); then
      REPLY_CHOICE="$choice"
      return 0
    fi
    echo "Invalid choice."
  done
}

prompt_location_with_recommendation() {
  local prompt="$1"
  local recommended="$2" # local | remote

  if [[ "${recommended}" == "local" ]]; then
    prompt_select "${prompt}" \
      "Local machine (recommended for selected mode)" \
      "Remote server"
    if [[ "${REPLY_CHOICE}" == "1" ]]; then
      REPLY_LOCATION="local"
    else
      REPLY_LOCATION="remote"
    fi
    return 0
  fi

  prompt_select "${prompt}" \
    "Remote server (recommended for selected mode)" \
    "Local machine"
  if [[ "${REPLY_CHOICE}" == "1" ]]; then
    REPLY_LOCATION="remote"
  else
    REPLY_LOCATION="local"
  fi
}

prompt_select "Deployment mode" \
  "Frontend local, backend remote, cloud databases" \
  "All local (frontend + backend + local databases)" \
  "All remote, cloud databases" \
  "All remote, self-hosted databases on same server"
mode_choice="${REPLY_CHOICE}"

prompt_select "Paper object storage provider" \
  "Local MinIO (host/device/client)" \
  "AWS S3" \
  "Aliyun OSS (S3 compatible)"
storage_choice="${REPLY_CHOICE}"

prompt_select "Document metadata store (documents/tags/auth)" \
  "Local SQLite (libSQL file mode)" \
  "Turso Cloud (libSQL)"
doc_meta_choice="${REPLY_CHOICE}"

prompt_select "ResearchOps metadata store (projects/ideas/runs/events)" \
  "Local MongoDB" \
  "MongoDB Atlas"
research_meta_choice="${REPLY_CHOICE}"

prompt_select "Remote networking strategy" \
  "Direct backend access (no FRP)" \
  "FRP offload (DO -> local executor)" \
  "FRP + Tailscale"
network_choice="${REPLY_CHOICE}"

prompt_select "Twitter/X Playwright refresh execution target" \
  "Backend server (always-on refresh recommended)" \
  "Client device via proxy (refresh only when client is online)"
tracker_exec_choice="${REPLY_CHOICE}"

prompt_select "Enable ARIS research workflow integration" \
  "Yes (clone ARIS skills and use Auto Researcher as MCP paper library)" \
  "No"
aris_integration_choice="${REPLY_CHOICE}"

mode_name=""
frontend_default_api_url="https://your-domain-or-ip/api"
backend_port="3000"
reader_enabled="true"
tracker_enabled="true"
tracker_proxy_heavy_ops="false"
tracker_proxy_strict="false"
tracker_execution_target="backend"
tracker_stale_auto_run="true"
tracker_stale_proxy_auto_run="true"
tracker_stale_run_trigger_ms="86400000"
processing_enabled="false"
processing_desktop_url="http://127.0.0.1:7001"
tailscale_enabled="false"
tailscale_desktop_url=""
frontend_compile_default="local"
backend_compile_default="local"
frontend_deploy_default="local"
backend_deploy_default="local"
aris_integration_enabled="false"
aris_skills_repo="${ARIS_SKILLS_REPO:-https://github.com/CurryTang/Auto-claude-code-research-in-sleep.git}"
aris_skills_ref="${ARIS_SKILLS_REF:-main}"

case "${mode_choice}" in
  1)
    mode_name="frontend_local_backend_remote_cloud_db"
    reader_enabled="false"
    tracker_enabled="false"
    tracker_proxy_heavy_ops="true"
    processing_enabled="true"
    frontend_default_api_url="https://your-remote-backend-domain/api"
    frontend_compile_default="local"
    backend_compile_default="remote"
    frontend_deploy_default="local"
    backend_deploy_default="remote"
    ;;
  2)
    mode_name="all_local"
    reader_enabled="true"
    tracker_enabled="true"
    tracker_proxy_heavy_ops="false"
    processing_enabled="false"
    frontend_default_api_url="http://127.0.0.1:${backend_port}/api"
    frontend_compile_default="local"
    backend_compile_default="local"
    frontend_deploy_default="local"
    backend_deploy_default="local"
    ;;
  3)
    mode_name="all_remote_cloud_db"
    reader_enabled="true"
    tracker_enabled="true"
    tracker_proxy_heavy_ops="false"
    processing_enabled="false"
    frontend_default_api_url="https://your-remote-frontend-domain/api"
    frontend_compile_default="remote"
    backend_compile_default="remote"
    frontend_deploy_default="remote"
    backend_deploy_default="remote"
    ;;
  4)
    mode_name="all_remote_self_hosted_db"
    reader_enabled="true"
    tracker_enabled="true"
    tracker_proxy_heavy_ops="false"
    processing_enabled="false"
    frontend_default_api_url="https://your-remote-frontend-domain/api"
    frontend_compile_default="remote"
    backend_compile_default="remote"
    frontend_deploy_default="remote"
    backend_deploy_default="remote"
    ;;
esac

if [[ "${network_choice}" == "2" ]]; then
  processing_enabled="true"
  processing_desktop_url="http://127.0.0.1:7001"
elif [[ "${network_choice}" == "3" ]]; then
  processing_enabled="true"
  tailscale_enabled="true"
  tailscale_desktop_url="http://100.64.0.10:7001"
  processing_desktop_url="http://127.0.0.1:7001"
fi

if [[ "${tracker_exec_choice}" == "2" ]]; then
  tracker_execution_target="client"
  processing_enabled="true"
  tracker_proxy_heavy_ops="true"
  tracker_enabled="false"
  # In client mode, do not fall back to backend-local heavy execution.
  tracker_proxy_strict="true"
  tracker_stale_proxy_auto_run="true"
else
  tracker_execution_target="backend"
  tracker_proxy_heavy_ops="false"
  tracker_enabled="true"
  tracker_proxy_strict="false"
  tracker_stale_proxy_auto_run="false"
fi

if [[ "${aris_integration_choice}" == "1" ]]; then
  aris_integration_enabled="true"
fi

object_provider="aws-s3"
object_bucket="auto-reader-documents"
object_region="us-east-1"
object_access_key="<your-access-key>"
object_secret_key="<your-secret-key>"
object_endpoint=""
object_force_path_style="false"
object_public_base_url=""

case "${storage_choice}" in
  1)
    object_provider="minio"
    object_bucket="auto-reader-documents"
    object_region="us-east-1"
    object_access_key="minioadmin"
    object_secret_key="minioadmin"
    object_endpoint="http://127.0.0.1:9000"
    object_force_path_style="true"
    object_public_base_url="http://127.0.0.1:9000/auto-reader-documents"
    ;;
  2)
    object_provider="aws-s3"
    object_bucket="your-aws-bucket"
    object_region="us-east-1"
    object_access_key="<aws-access-key-id>"
    object_secret_key="<aws-secret-access-key>"
    ;;
  3)
    object_provider="aliyun-oss"
    object_bucket="your-oss-bucket"
    object_region="oss-cn-hangzhou"
    object_access_key="<aliyun-access-key-id>"
    object_secret_key="<aliyun-access-key-secret>"
    object_endpoint="https://oss-cn-hangzhou.aliyuncs.com"
    object_force_path_style="false"
    object_public_base_url="https://your-oss-bucket.oss-cn-hangzhou.aliyuncs.com"
    ;;
esac

turso_url="file:./local.db"
turso_token=""
if [[ "${doc_meta_choice}" == "2" ]]; then
  turso_url="libsql://your-db.turso.io"
  turso_token="<your-turso-auth-token>"
fi

db_provider="mongodb"
mongodb_uri="mongodb://127.0.0.1:27017/auto_researcher"
mongodb_db_name="auto_researcher"
if [[ "${research_meta_choice}" == "2" ]]; then
  mongodb_uri="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/auto_researcher?retryWrites=true&w=majority"
fi

# ─── User account setup ───────────────────────────────────────────────────────
echo ""
echo "─── User Account Setup ───"
echo "The app supports two built-in user accounts: 'czk' (primary) and 'lyf' (optional)."

# Generate secure random strings for admin token and JWT secret
admin_token="$(LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 32 || true)"
jwt_secret="$(LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 64 || true)"

# Primary user (czk)
while true; do
  read -r -s -p "Set password for user 'czk': " czk_password
  echo ""
  if [[ -z "${czk_password}" ]]; then
    echo "Password cannot be empty."
    continue
  fi
  read -r -s -p "Confirm password: " czk_password_confirm
  echo ""
  if [[ "${czk_password}" != "${czk_password_confirm}" ]]; then
    echo "Passwords do not match. Try again."
    continue
  fi
  break
done

# Optional second user (lyf)
lyf_password=""
read -r -p "Set up second user 'lyf'? (y/N): " add_lyf
if [[ "${add_lyf}" =~ ^[Yy] ]]; then
  while true; do
    read -r -s -p "Set password for user 'lyf': " lyf_password
    echo ""
    if [[ -z "${lyf_password}" ]]; then
      echo "Password cannot be empty."
      continue
    fi
    read -r -s -p "Confirm password: " lyf_password_confirm
    echo ""
    if [[ "${lyf_password}" != "${lyf_password_confirm}" ]]; then
      echo "Passwords do not match. Try again."
      continue
    fi
    break
  done
fi

echo ""
echo "Admin API token and JWT secret auto-generated."
echo ""

prompt_location_with_recommendation "Frontend build/compile location" "${frontend_compile_default}"
frontend_compile_on="${REPLY_LOCATION}"
prompt_location_with_recommendation "Backend build/compile location" "${backend_compile_default}"
backend_compile_on="${REPLY_LOCATION}"
prompt_location_with_recommendation "Frontend deploy/runtime target" "${frontend_deploy_default}"
frontend_deploy_on="${REPLY_LOCATION}"
prompt_location_with_recommendation "Backend deploy/runtime target" "${backend_deploy_default}"
backend_deploy_on="${REPLY_LOCATION}"

cat > "${BACKEND_ENV_OUT}" <<EOF
# Generated by scripts/install.sh
# Mode: ${mode_name}

PORT=${backend_port}
NODE_ENV=production

# Auth
AUTH_ENABLED=true
ADMIN_TOKEN=${admin_token}
JWT_SECRET=${jwt_secret}
CZK_PASSWORD=${czk_password}
LYF_PASSWORD=${lyf_password}

# Metadata stores
# Documents/tags/auth use libSQL/Turso
TURSO_DATABASE_URL=${turso_url}
TURSO_AUTH_TOKEN=${turso_token}
# ResearchOps metadata uses MongoDB
DB_PROVIDER=${db_provider}
MONGODB_URI=${mongodb_uri}
MONGODB_DB_NAME=${mongodb_db_name}

# Object storage: aws-s3 | minio | aliyun-oss
OBJECT_STORAGE_PROVIDER=${object_provider}
OBJECT_STORAGE_BUCKET=${object_bucket}
OBJECT_STORAGE_REGION=${object_region}
OBJECT_STORAGE_ACCESS_KEY_ID=${object_access_key}
OBJECT_STORAGE_SECRET_ACCESS_KEY=${object_secret_key}
OBJECT_STORAGE_ENDPOINT=${object_endpoint}
OBJECT_STORAGE_FORCE_PATH_STYLE=${object_force_path_style}
OBJECT_STORAGE_PUBLIC_BASE_URL=${object_public_base_url}

# Backward compatibility aliases
AWS_ACCESS_KEY_ID=${object_access_key}
AWS_SECRET_ACCESS_KEY=${object_secret_key}
AWS_REGION=${object_region}
AWS_S3_BUCKET=${object_bucket}

# Remote offload / networking
PROCESSING_ENABLED=${processing_enabled}
PROCESSING_DESKTOP_URL=${processing_desktop_url}
PROCESSING_TIMEOUT=300000
TRACKER_ENABLED=${tracker_enabled}
TRACKER_PROXY_HEAVY_OPS=${tracker_proxy_heavy_ops}
TRACKER_PROXY_STRICT=${tracker_proxy_strict}
TRACKER_DESKTOP_URL=${processing_desktop_url:-http://127.0.0.1:7001}
TRACKER_PROXY_TIMEOUT=120000
TRACKER_EXECUTION_TARGET=${tracker_execution_target}
TRACKER_STALE_AUTO_RUN=${tracker_stale_auto_run}
TRACKER_STALE_PROXY_AUTO_RUN=${tracker_stale_proxy_auto_run}
TRACKER_STALE_RUN_TRIGGER_MS=${tracker_stale_run_trigger_ms}
TAILSCALE_ENABLED=${tailscale_enabled}
TAILSCALE_DESKTOP_URL=${tailscale_desktop_url}

# Reader runtime
READER_ENABLED=${reader_enabled}
READER_DEFAULT_PROVIDER=codex-cli
READER_CONCURRENCY=1

# CORS
CORS_ORIGIN=*
EOF

cat > "${FRONTEND_ENV_OUT}" <<EOF
# Generated by scripts/install.sh
# Mode: ${mode_name}

# Frontend runtime API targets
NEXT_PUBLIC_DEV_API_URL=/api
NEXT_PUBLIC_API_URL=${frontend_default_api_url}
NEXT_PUBLIC_API_TIMEOUT_MS=15000

# Next.js dev proxy target for /api/*
NEXT_DEV_BACKEND_URL=http://127.0.0.1:${backend_port}
EOF

cat > "${PROFILE_OUT}" <<EOF
# Generated deployment profile
MODE_NAME=${mode_name}
NETWORK_MODE=$( [[ "${network_choice}" == "1" ]] && echo "direct" || ([[ "${network_choice}" == "2" ]] && echo "frp" || echo "frp+tailscale") )
FRONTEND_COMPILE_ON=${frontend_compile_on}
BACKEND_COMPILE_ON=${backend_compile_on}
FRONTEND_DEPLOY_ON=${frontend_deploy_on}
BACKEND_DEPLOY_ON=${backend_deploy_on}
DOC_METADATA_PROVIDER=$( [[ "${doc_meta_choice}" == "1" ]] && echo "sqlite-local" || echo "turso-cloud" )
RESEARCH_METADATA_PROVIDER=$( [[ "${research_meta_choice}" == "1" ]] && echo "mongodb-local" || echo "mongodb-atlas" )
OBJECT_STORAGE_PROVIDER=${object_provider}
TRACKER_EXECUTION_TARGET=${tracker_execution_target}
ARIS_INTEGRATION_ENABLED=${aris_integration_enabled}
ARIS_SKILLS_REPO=${aris_skills_repo}
ARIS_SKILLS_REF=${aris_skills_ref}
EOF

echo ""
echo "Generated:"
echo "  - ${BACKEND_ENV_OUT}"
echo "  - ${FRONTEND_ENV_OUT}"
echo "  - ${PROFILE_OUT}"

# ─── Optional: Set up MinIO ──────────────────────────────────────────────────
if [[ "${object_provider}" == "minio" ]]; then
  echo ""
  echo "─── MinIO Setup ───"
  echo "You selected MinIO for PDF storage."
  read -r -p "Set up MinIO now? (Y/n): " setup_minio
  if [[ ! "${setup_minio}" =~ ^[Nn] ]]; then
    minio_ready=false

    # Check if MinIO is installed
    if command -v minio >/dev/null 2>&1; then
      echo "  MinIO binary found."
    else
      echo "  MinIO not found. Installing..."
      if command -v brew >/dev/null 2>&1; then
        brew install minio/stable/minio 2>&1 | tail -3
      elif command -v apt-get >/dev/null 2>&1; then
        echo "  Install MinIO manually: https://min.io/docs/minio/linux/index.html"
        echo "  Skipping MinIO setup — you can re-run this step later."
      else
        echo "  Install MinIO manually: https://min.io/download"
        echo "  Skipping MinIO setup — you can re-run this step later."
      fi
    fi

    if command -v minio >/dev/null 2>&1; then
      minio_data="${HOME}/minio-data"
      read -r -p "MinIO data directory [${minio_data}]: " minio_data_input
      minio_data="${minio_data_input:-${minio_data}}"
      mkdir -p "${minio_data}"

      # Check if MinIO is already running
      if curl -s http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
        echo "  MinIO is already running on port 9000."
        minio_ready=true
      else
        echo "  Starting MinIO server..."
        MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \
          minio server "${minio_data}" --address :9000 --console-address :9001 &>/tmp/minio-install.log &
        minio_pid=$!
        sleep 2
        if curl -s http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
          echo "  MinIO started (PID: ${minio_pid})."
          echo "  Console: http://127.0.0.1:9001 (minioadmin/minioadmin)"
          minio_ready=true
        else
          echo "  Failed to start MinIO. Check /tmp/minio-install.log"
        fi
      fi

      # Create bucket if MinIO client is available
      if [[ "${minio_ready}" == "true" ]]; then
        if command -v mc >/dev/null 2>&1; then
          mc alias set amadeus-local http://127.0.0.1:9000 minioadmin minioadmin >/dev/null 2>&1
          if mc ls amadeus-local/auto-reader-documents >/dev/null 2>&1; then
            echo "  Bucket 'auto-reader-documents' already exists."
          else
            mc mb amadeus-local/auto-reader-documents >/dev/null 2>&1
            mc anonymous set download amadeus-local/auto-reader-documents >/dev/null 2>&1
            echo "  Created bucket 'auto-reader-documents' with public download."
          fi
        else
          echo "  MinIO client (mc) not found — install it to create the bucket automatically:"
          if command -v brew >/dev/null 2>&1; then
            echo "    brew install minio/stable/mc"
          else
            echo "    https://min.io/docs/minio/linux/reference/minio-mc.html"
          fi
          echo "  Then run:"
          echo "    mc alias set local http://127.0.0.1:9000 minioadmin minioadmin"
          echo "    mc mb local/auto-reader-documents"
          echo "    mc anonymous set download local/auto-reader-documents"
        fi
      fi

      echo ""
      echo "  Note: MinIO runs in the background. To start it on boot, create a"
      echo "  launchd plist (macOS) or systemd service (Linux), or just re-run:"
      echo "    MINIO_ROOT_USER=minioadmin MINIO_ROOT_PASSWORD=minioadmin \\"
      echo "      minio server ${minio_data} --address :9000 --console-address :9001 &"
    fi
  else
    echo "  Skipped. You can set up MinIO later — see the README for instructions."
  fi
fi

# ─── Optional: Install dependencies and start ────────────────────────────────
echo ""
echo "─── Install & Start ───"
read -r -p "Apply env files and install dependencies now? (Y/n): " do_install
if [[ ! "${do_install}" =~ ^[Nn] ]]; then
  echo "  Applying env files..."
  cp "${BACKEND_ENV_OUT}" "${ROOT_DIR}/backend/.env"
  cp "${FRONTEND_ENV_OUT}" "${ROOT_DIR}/frontend/.env"

  echo "  Installing backend dependencies..."
  (cd "${ROOT_DIR}/backend" && npm install --no-audit --no-fund 2>&1 | tail -3)

  echo "  Installing frontend dependencies..."
  (cd "${ROOT_DIR}/frontend" && npm install --no-audit --no-fund 2>&1 | tail -3)

  echo ""
  read -r -p "Start the app now? (Y/n): " do_start
  if [[ ! "${do_start}" =~ ^[Nn] ]]; then
    echo "  Starting backend on port ${backend_port}..."
    (cd "${ROOT_DIR}/backend" && node src/index.js &>/tmp/amadeus-backend.log &)
    backend_pid=$!
    sleep 2

    echo "  Starting frontend..."
    (cd "${ROOT_DIR}/frontend" && npx next dev &>/tmp/amadeus-frontend.log &)
    frontend_pid=$!
    sleep 3

    echo ""
    echo "  Backend:  http://127.0.0.1:${backend_port}  (PID: ${backend_pid}, log: /tmp/amadeus-backend.log)"
    echo "  Frontend: http://127.0.0.1:3000  (PID: ${frontend_pid}, log: /tmp/amadeus-frontend.log)"
    echo ""
    echo "  Login with username 'czk' and the password you set."
    echo ""
    echo "  To stop: kill ${backend_pid} ${frontend_pid}"
  else
    echo ""
    echo "  To start later:"
    echo "    cd ${ROOT_DIR}/backend && node src/index.js"
    echo "    cd ${ROOT_DIR}/frontend && npx next dev"
  fi
else
  echo ""
  echo "Next steps:"
  echo "  1) Apply env files:"
  echo "       cp ${BACKEND_ENV_OUT} ${ROOT_DIR}/backend/.env"
  echo "       cp ${FRONTEND_ENV_OUT} ${ROOT_DIR}/frontend/.env"
  echo "  2) Install dependencies:"
  echo "       cd ${ROOT_DIR}/backend && npm install"
  echo "       cd ${ROOT_DIR}/frontend && npm install"
  echo "  3) Start the app:"
  echo "       cd ${ROOT_DIR}/backend && node src/index.js"
  echo "       cd ${ROOT_DIR}/frontend && npx next dev"
fi

echo ""
if [[ "${object_provider}" != "minio" ]]; then
  echo "Remember to configure your object storage credentials in backend/.env"
fi
echo "If using FRP mode, run:"
echo "  DO_HOST=<your-server> ${ROOT_DIR}/scripts/set-do-tracker-proxy.sh"
echo "  DO_HOST=<your-server> PUBLIC_TRACKER_STATUS_URL=<your-url> ${ROOT_DIR}/scripts/verify-frp-offload.sh"
if [[ "${aris_integration_enabled}" == "true" ]]; then
  echo ""
  echo "To install ARIS into a project and register the MCP backend:"
  echo "  ARIS_SKILLS_REPO=${aris_skills_repo} ${ROOT_DIR}/scripts/setup-aris-integration.sh /path/to/project"
  echo "  claude mcp add auto-researcher -s project -- node ${ROOT_DIR}/backend/src/mcp/auto-researcher-mcp-server.js"
fi
