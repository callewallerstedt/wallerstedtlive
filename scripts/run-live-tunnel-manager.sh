#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/calle/.openclaw/workspace/wallerstedtlive"
STATE_FILE="$REPO_DIR/.tunnel_url"
LOG_FILE="$REPO_DIR/.tunnel_manager.log"

cd "$REPO_DIR"

echo "[$(date -Is)] tunnel-manager start" >> "$LOG_FILE"

while true; do
  ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=20 -o ServerAliveCountMax=3 -R 80:localhost:8787 nokey@localhost.run 2>&1 \
    | while IFS= read -r line; do
        echo "[$(date -Is)] $line" >> "$LOG_FILE"
        if [[ "$line" =~ (https://[a-z0-9.-]+\.lhr\.life) ]]; then
          NEW_URL="${BASH_REMATCH[1]}"
          OLD_URL=""
          [[ -f "$STATE_FILE" ]] && OLD_URL="$(cat "$STATE_FILE")"
          if [[ "$NEW_URL" != "$OLD_URL" ]]; then
            echo "$NEW_URL" > "$STATE_FILE"
            echo "[$(date -Is)] new tunnel: $NEW_URL" >> "$LOG_FILE"
            printf '%s' "$NEW_URL" | vercel env update LIVE_WORKER_URL production --yes >> "$LOG_FILE" 2>&1 || true
            vercel --prod --yes >> "$LOG_FILE" 2>&1 || true
          fi
        fi
      done

  echo "[$(date -Is)] ssh tunnel exited, restarting in 3s" >> "$LOG_FILE"
  sleep 3
done
