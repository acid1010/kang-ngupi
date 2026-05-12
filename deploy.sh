#!/bin/bash
# deploy.sh — Server-side deploy script
# Called by GitHub Actions or manually: ./deploy.sh
#
# What it does:
#   1. git pull latest changes
#   2. npm install (if package.json changed)
#   3. PM2 restart (if backend code changed)

set -euo pipefail

WORKSPACE_DIR="${DEPLOY_DIR:-$HOME/workspace-sobatngupi}"
cd "$WORKSPACE_DIR"

echo "=== Deploy started at $(date) ==="
echo "Directory: $WORKSPACE_DIR"

# 1. Pull latest
BEFORE=$(git rev-parse HEAD)
git pull origin main
AFTER=$(git rev-parse HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  echo "No changes to deploy."
  exit 0
fi

echo "Updated: $BEFORE → $AFTER"
CHANGED_FILES=$(git diff --name-only "$BEFORE" "$AFTER")
echo "Changed files:"
echo "$CHANGED_FILES"
echo ""

# 2. npm install if dependencies changed
if echo "$CHANGED_FILES" | grep -q "backend/package"; then
  echo "→ package.json changed, running npm install..."
  # --omit=dev skips devDeps; rebuild native modules (bcrypt, sharp) from source
  cd backend && npm install --omit=dev && cd ..
fi

# 3. PM2 restart if backend code or scripts changed
if echo "$CHANGED_FILES" | grep -qE "^backend/src/|^backend/ecosystem|^backend/.*\.js$"; then
  echo "→ Backend code changed, restarting PM2..."
  cd backend && pm2 restart ecosystem.config.cjs --update-env && cd ..
  echo "PM2 restarted."
else
  echo "→ No backend code changes, skipping PM2 restart."
fi

# 4. Cleanup memory if script exists and was updated
if echo "$CHANGED_FILES" | grep -q "cleanup-memory.sh"; then
  chmod +x cleanup-memory.sh
fi

echo ""
echo "=== Deploy complete at $(date) ==="
