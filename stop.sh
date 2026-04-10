#!/bin/bash
# SobatNgupi — Stop all services via PM2
set -e
cd "$(dirname "$0")/backend"
pm2 stop ecosystem.config.cjs
pm2 delete ecosystem.config.cjs
echo "All services stopped."
