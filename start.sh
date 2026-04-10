#!/bin/bash
# SobatNgupi — Start all services via PM2
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"

echo "Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install

echo "Starting backend + ngrok via PM2..."
pm2 start ecosystem.config.cjs

echo "Saving PM2 state for auto-start on boot..."
pm2 save

echo ""
echo "Done. Services running:"
pm2 list
echo ""
echo "Logs: npm run logs --prefix backend"
echo "Stop:  npm run stop:pm2 --prefix backend"
