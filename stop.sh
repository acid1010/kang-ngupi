#!/bin/bash
# SobatNgupi — Stop backend services via PM2
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 command not found"
  exit 1
fi

pm2 stop "${BACKEND_DIR}/ecosystem.config.cjs" || true
pm2 delete "${BACKEND_DIR}/ecosystem.config.cjs" || true
echo "All services stopped."
