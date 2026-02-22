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

mode_name=""
frontend_default_api_url="https://your-domain-or-ip/api"
backend_port="3000"
reader_enabled="true"
tracker_enabled="true"
tracker_proxy_heavy_ops="false"
processing_enabled="false"
processing_desktop_url="http://127.0.0.1:7001"
tailscale_enabled="false"
tailscale_desktop_url=""
frontend_compile_default="local"
backend_compile_default="local"
frontend_deploy_default="local"
backend_deploy_default="local"

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
  tracker_proxy_heavy_ops="true"
  tracker_enabled="false"
  processing_desktop_url="http://127.0.0.1:7001"
elif [[ "${network_choice}" == "3" ]]; then
  processing_enabled="true"
  tracker_proxy_heavy_ops="true"
  tracker_enabled="false"
  tailscale_enabled="true"
  tailscale_desktop_url="http://100.64.0.10:7001"
  processing_desktop_url="http://127.0.0.1:7001"
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
ADMIN_TOKEN=<set-admin-token>
JWT_SECRET=<set-64-char-random-secret>
CZK_PASSWORD=<set-user-password>
LYF_PASSWORD=<set-user-password>

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
TRACKER_DESKTOP_URL=${processing_desktop_url:-http://127.0.0.1:7001}
TRACKER_PROXY_TIMEOUT=120000
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
EOF

echo ""
echo "Generated:"
echo "  - ${BACKEND_ENV_OUT}"
echo "  - ${FRONTEND_ENV_OUT}"
echo "  - ${PROFILE_OUT}"
echo ""
echo "Next steps:"
echo "  1) Review generated files and replace placeholder credentials."
echo "  2) Apply env files:"
echo "       cp ${BACKEND_ENV_OUT} ${ROOT_DIR}/backend/.env"
echo "       cp ${FRONTEND_ENV_OUT} ${ROOT_DIR}/frontend/.env"
echo "  3) If using FRP mode, run:"
echo "       ${ROOT_DIR}/scripts/set-do-tracker-proxy.sh"
echo "       ${ROOT_DIR}/scripts/verify-frp-offload.sh"
