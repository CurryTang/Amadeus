#!/usr/bin/env bash
set -euo pipefail

REMOTE="origin"
BRANCH=""
REPO=""
DRY_RUN=0
SKIP_BACKEND=0
SKIP_NPM=0
SKIP_PLAYWRIGHT=0
ALLOW_DIRTY=0

log() {
  printf '[repo-sync-updater] %s\n' "$*"
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat <<'EOF'
Usage: sync_wsl_repo.sh [options]

Options:
  --repo <path>          Repo path (default: current directory)
  --remote <name>        Git remote (default: origin)
  --branch <name>        Branch to sync (default: current branch or remote HEAD branch)
  --dry-run              Print planned mutations without changing repo/dependencies
  --skip-backend         Skip backend dependency refresh
  --skip-npm             Skip npm ci in backend
  --skip-playwright      Skip Playwright browser install in backend
  --allow-dirty          Allow pull when working tree is dirty
  -h, --help             Show help

Examples:
  bash scripts/sync_wsl_repo.sh --repo /home/jjo01/auto-researcher --dry-run --skip-backend
  bash scripts/sync_wsl_repo.sh --repo /home/jjo01/auto-researcher
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --repo)
        [[ $# -ge 2 ]] || die "Missing value for --repo"
        REPO="$2"
        shift 2
        ;;
      --remote)
        [[ $# -ge 2 ]] || die "Missing value for --remote"
        REMOTE="$2"
        shift 2
        ;;
      --branch)
        [[ $# -ge 2 ]] || die "Missing value for --branch"
        BRANCH="$2"
        shift 2
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --skip-backend)
        SKIP_BACKEND=1
        shift
        ;;
      --skip-npm)
        SKIP_NPM=1
        shift
        ;;
      --skip-playwright)
        SKIP_PLAYWRIGHT=1
        shift
        ;;
      --allow-dirty)
        ALLOW_DIRTY=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

detect_branch() {
  if [[ -n "$BRANCH" ]]; then
    return 0
  fi

  local current_branch
  current_branch="$(git -C "$REPO" symbolic-ref --short -q HEAD || true)"
  if [[ -n "$current_branch" ]]; then
    BRANCH="$current_branch"
    return 0
  fi

  BRANCH="$(git -C "$REPO" remote show "$REMOTE" 2>/dev/null | sed -n '/HEAD branch/s/.*: //p' || true)"
  [[ -n "$BRANCH" ]] || die "Cannot determine branch. Pass --branch explicitly."
}

split_counts() {
  local counts="$1"
  read -r AHEAD BEHIND <<<"$counts"
  [[ "$AHEAD" =~ ^[0-9]+$ ]] || die "Unexpected ahead count: '$AHEAD'"
  [[ "$BEHIND" =~ ^[0-9]+$ ]] || die "Unexpected behind count: '$BEHIND'"
}

refresh_counts() {
  local counts
  counts="$(git -C "$REPO" rev-list --left-right --count "HEAD...${REMOTE}/${BRANCH}" 2>/dev/null || true)"
  [[ -n "$counts" ]] || die "Cannot compare HEAD with ${REMOTE}/${BRANCH}. Check remote/branch names."
  split_counts "$counts"
}

install_backend_prereqs() {
  local backend_dir
  backend_dir="${REPO}/backend"
  [[ -d "$backend_dir" ]] || die "Backend directory not found at: $backend_dir"

  if [[ "$SKIP_NPM" -eq 1 ]]; then
    log "Skipping npm ci (--skip-npm)."
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would run 'npm ci' in ${backend_dir}"
  else
    log "Running npm ci in backend/"
    (cd "$backend_dir" && npm ci)
  fi

  if [[ "$SKIP_PLAYWRIGHT" -eq 1 ]]; then
    log "Skipping Playwright browser install (--skip-playwright)."
  elif [[ "$DRY_RUN" -eq 1 ]]; then
    log "Dry run: would run 'npx playwright install chromium' in ${backend_dir}"
  else
    log "Installing Playwright Chromium in backend/"
    (cd "$backend_dir" && npx playwright install chromium)
  fi
}

main() {
  parse_args "$@"

  if [[ -z "$REPO" ]]; then
    REPO="$(pwd)"
  fi

  git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Not a git repo: $REPO"
  REPO="$(git -C "$REPO" rev-parse --show-toplevel)"
  detect_branch

  log "Repo: $REPO"
  log "Remote branch: ${REMOTE}/${BRANCH}"

  log "Fetching latest refs..."
  git -C "$REPO" fetch "$REMOTE" --prune

  refresh_counts
  local dirty_count
  dirty_count="$(git -C "$REPO" status --porcelain | wc -l | tr -d ' ')"
  log "Before sync: ahead=${AHEAD}, behind=${BEHIND}, dirty_files=${dirty_count}"

  if [[ "$BEHIND" -gt 0 ]]; then
    if [[ "$dirty_count" -gt 0 && "$ALLOW_DIRTY" -ne 1 ]]; then
      die "Repo is behind and dirty. Commit/stash changes or rerun with --allow-dirty."
    fi

    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "Dry run: would run 'git pull --ff-only ${REMOTE} ${BRANCH}'"
    else
      log "Pulling latest with fast-forward only..."
      git -C "$REPO" pull --ff-only "$REMOTE" "$BRANCH"
    fi
  else
    log "Repo already up to date with ${REMOTE}/${BRANCH}."
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    refresh_counts
    log "After sync: ahead=${AHEAD}, behind=${BEHIND}"
    [[ "$BEHIND" -eq 0 ]] || die "Still behind after sync. Resolve branch divergence manually."
  fi

  if [[ "$SKIP_BACKEND" -eq 1 ]]; then
    log "Skipping backend refresh (--skip-backend)."
  else
    install_backend_prereqs
  fi

  log "Done. Restart backend service if it is running."
}

main "$@"
