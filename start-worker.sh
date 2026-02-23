#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE="$HOME/.worker-env"
if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] Missing $ENV_FILE — create it first (see docs/worker-setup.md)"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

if [ -z "${DATABASE_URL:-}" ] || [[ "$DATABASE_URL" == file:* ]]; then
  echo "[ERROR] DATABASE_URL is not set or is a local SQLite path."
  echo "Edit $ENV_FILE with your Vercel Postgres URL."
  exit 1
fi

PORT="${LIVE_WORKER_PORT:-8787}"

cleanup() {
  echo ""
  echo "Shutting down..."
  [ -n "${WORKER_PID:-}" ] && kill "$WORKER_PID" 2>/dev/null || true
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  wait 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

echo "=== Starting Live Worker on port $PORT ==="
node services/live-worker/index.mjs &
WORKER_PID=$!

sleep 3

if curl -sf "http://127.0.0.1:$PORT/track/health" > /dev/null 2>&1; then
  echo "[OK] Worker is healthy"
else
  echo "[WARN] Worker health check failed — may still be starting"
fi

echo ""
echo "=== Starting Cloudflare Tunnel ==="
echo "Look for the tunnel URL below (https://xxxxx.trycloudflare.com)"
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Copy the tunnel URL and set it as LIVE_WORKER_URL      ║"
echo "║  in your Vercel Environment Variables, then redeploy.   ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

cloudflared tunnel --url "http://127.0.0.1:$PORT" &
TUNNEL_PID=$!

wait
