#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${MCP_REPO_URL:-https://github.com/maciejimbierowicz/mcp.git}"
BRANCH="${1:-main}"
RELEASES_DIR="${MCP_RELEASES_DIR:-/opt/4grow-mcp-releases}"
SHARED_DIR="${MCP_SHARED_DIR:-/opt/4grow-mcp-shared}"
CURRENT_LINK="${MCP_CURRENT_LINK:-/opt/4grow-mcp}"
SERVICE="${MCP_SERVICE:-4grow-mcp.service}"
HEALTH_URL="${MCP_HEALTH_URL:-http://127.0.0.1:3000/health}"
SMOKE_PORT="${MCP_SMOKE_PORT:-3001}"
KEEP_RELEASES="${MCP_KEEP_RELEASES:-5}"

log() {
  printf '==> %s\n' "$1"
}

wait_for_health() {
  local url="$1"
  local attempt
  for attempt in $(seq 1 40); do
    if curl -sf -m 3 -o /dev/null "$url"; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

if [ ! -f "$SHARED_DIR/.env" ]; then
  log "Missing $SHARED_DIR/.env. Create it before deploying."
  exit 1
fi

previous_release="$(readlink -f "$CURRENT_LINK" 2>/dev/null || true)"

log "Cloning $BRANCH from $REPO_URL"
mkdir -p "$RELEASES_DIR"
staging_dir="$RELEASES_DIR/$(date +%Y%m%d-%H%M%S)"
git clone --quiet --branch "$BRANCH" --single-branch "$REPO_URL" "$staging_dir"
release_sha="$(git -C "$staging_dir" rev-parse --short HEAD)"
release_dir="${staging_dir}-${release_sha}"
mv "$staging_dir" "$release_dir"
log "Release $release_dir"

log "Installing production dependencies"
(cd "$release_dir" && npm ci --omit=dev --silent)
ln -sfn "$SHARED_DIR/.env" "$release_dir/.env"

log "Smoke testing the release on port $SMOKE_PORT"
smoke_env="$(mktemp)"
chmod 600 "$smoke_env"
sed "s|^MCP_PORT=.*|MCP_PORT=$SMOKE_PORT|" "$SHARED_DIR/.env" > "$smoke_env"
grep -q '^MCP_PORT=' "$smoke_env" || printf 'MCP_PORT=%s\n' "$SMOKE_PORT" >> "$smoke_env"

(cd "$release_dir" && exec node --env-file="$smoke_env" src/server.mjs) >/tmp/mcp-smoke.log 2>&1 &
smoke_pid=$!
smoke_ok=0
if wait_for_health "http://127.0.0.1:$SMOKE_PORT/health"; then
  smoke_ok=1
fi
kill "$smoke_pid" 2>/dev/null || true
wait "$smoke_pid" 2>/dev/null || true
rm -f "$smoke_env"

if [ "$smoke_ok" -ne 1 ]; then
  log "Smoke test failed, the running release stays untouched. Log:"
  cat /tmp/mcp-smoke.log
  rm -rf "$release_dir"
  exit 1
fi

log "Switching $CURRENT_LINK and restarting $SERVICE"
sudo ln -sfn "$release_dir" "$CURRENT_LINK"
sudo systemctl restart "$SERVICE"

if ! wait_for_health "$HEALTH_URL"; then
  log "Health check failed after restart, rolling back"
  if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
    sudo ln -sfn "$previous_release" "$CURRENT_LINK"
    sudo systemctl restart "$SERVICE"
    wait_for_health "$HEALTH_URL" && log "Rolled back to $previous_release"
  else
    log "No previous release to roll back to."
  fi
  exit 1
fi

log "Healthy on $release_sha"

cd "$RELEASES_DIR"
ls -1dt */ 2>/dev/null | tail -n "+$((KEEP_RELEASES + 1))" | while read -r old; do
  old_path="$RELEASES_DIR/${old%/}"
  if [ "$old_path" != "$release_dir" ] && [ "$old_path" != "$previous_release" ]; then
    log "Pruning $old_path"
    rm -rf "$old_path"
  fi
done

log "Deployed $BRANCH ($release_sha)"
