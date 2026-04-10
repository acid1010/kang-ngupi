#!/bin/bash
# SobatNgupi — Start all services via PM2
set -e

BACKEND_DIR="$(cd "$(dirname "$0")/backend" && pwd)"

echo "Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install

# Install cloudflared if not present
if ! command -v cloudflared &> /dev/null; then
  echo "Installing cloudflared..."
  brew install cloudflared
fi

echo "Starting backend + Cloudflare Tunnel via PM2..."
pm2 start ecosystem.config.cjs

sleep 3
TUNNEL_URL=$(pm2 logs ngupi-tunnel --nostream --lines 0 2>/dev/null | grep -o 'https://[^ ]*trycloudflare.com' | head -1)
if [ -n "$TUNNEL_URL" ]; then
  echo ""
  echo "=== TUNNEL URL ==="
  echo "$TUNNEL_URL"
  echo "=================="
  echo ""
  echo "Update your WhatsApp webhook to: $TUNNEL_URL/webhooks/whatsapp"
fi

echo "Saving PM2 state for auto-start on boot..."
pm2 save

echo ""
echo "Done. Services running:"
pm2 list
echo ""
echo "Logs: npm run logs --prefix backend"
echo "Stop:  npm run stop:pm2 --prefix backend"
