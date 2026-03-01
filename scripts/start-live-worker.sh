#!/usr/bin/env bash
set -euo pipefail
cd /home/calle/.openclaw/workspace/wallerstedtlive
set -a
source /home/calle/.worker-env
set +a
exec node services/live-worker/index.mjs >> /home/calle/.openclaw/workspace/wallerstedtlive/live-worker.log 2>&1
