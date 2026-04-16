#!/bin/bash
# Auto-update wacli from source (no Linux releases available)
# Run via cron: weekly

set -e

REPO="steipete/wacli"
INSTALL_DIR="$HOME/.local/bin"
BINARY="wacli"
BUILD_DIR="/tmp/wacli-build"

# Get current version
CURRENT=$($INSTALL_DIR/$BINARY --version 2>/dev/null | head -1 | grep -oP '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")

# Get latest tag from GitHub
LATEST=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v?([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "Failed to fetch latest version"
  exit 1
fi

echo "Current: v$CURRENT"
echo "Latest:  v$LATEST"

if [ "$CURRENT" = "$LATEST" ]; then
  echo "Already up to date"
  exit 0
fi

echo "Building wacli v$LATEST from source..."

# Clone and build
rm -rf "$BUILD_DIR"
git clone --depth 1 --branch "v$LATEST" "https://github.com/$REPO.git" "$BUILD_DIR" 2>&1

cd "$BUILD_DIR"
go build -o wacli ./cmd/wacli 2>&1

if [ ! -f "$BUILD_DIR/wacli" ]; then
  echo "Build failed"
  rm -rf "$BUILD_DIR"
  exit 1
fi

# Backup old binary
cp "$INSTALL_DIR/$BINARY" "$INSTALL_DIR/${BINARY}.bak" 2>/dev/null || true

# Install
mv "$BUILD_DIR/wacli" "$INSTALL_DIR/$BINARY"
chmod +x "$INSTALL_DIR/$BINARY"

NEW_VER=$($INSTALL_DIR/$BINARY --version 2>/dev/null | head -1 || echo "unknown")
echo "Updated: $NEW_VER"

# Cleanup
rm -rf "$BUILD_DIR"
echo "Done"
