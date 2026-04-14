#!/bin/bash
# SobatNgupi — Start backend services via PM2
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="${SCRIPT_DIR}/backend"

for cmd in node npm pm2; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Required command not found: $cmd"
    exit 1
  fi
done

mkdir -p "${BACKEND_DIR}/logs"

echo "Installing backend dependencies (production)..."
if [ -f "${BACKEND_DIR}/package-lock.json" ]; then
  npm ci --omit=dev --prefix "${BACKEND_DIR}"
else
  npm install --omit=dev --prefix "${BACKEND_DIR}"
fi

echo "Starting backend services via PM2..."
pm2 startOrReload "${BACKEND_DIR}/ecosystem.config.cjs" --update-env

echo "Saving PM2 state for auto-start on boot..."
pm2 save

echo ""
echo "Done. Services running:"
pm2 list
echo ""
echo "Logs: npm run logs --prefix backend"
echo "Stop:  ./stop.sh"
