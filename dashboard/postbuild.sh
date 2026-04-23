#!/bin/bash
# Auto-copy static files to standalone after build
# Required because Next.js standalone mode doesn't include static assets
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
STANDALONE="$DIR/.next/standalone"

if [ -d "$STANDALONE" ]; then
  mkdir -p "$STANDALONE/.next"
  cp -r "$DIR/.next/static" "$STANDALONE/.next/static"
  cp -r "$DIR/public" "$STANDALONE/public"
  echo "✅ Static files copied to standalone"
else
  echo "⚠️ No standalone directory found"
fi
