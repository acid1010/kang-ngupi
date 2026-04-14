#!/bin/bash
# cleanup-memory.sh — Archive old memory session logs
#
# Usage:
#   ./cleanup-memory.sh              # Archive logs older than 7 days (default)
#   ./cleanup-memory.sh 14           # Archive logs older than 14 days
#   ./cleanup-memory.sh 0            # Archive ALL logs
#   ./cleanup-memory.sh --dry-run    # Preview what would be archived
#   ./cleanup-memory.sh --dry-run 3  # Preview logs older than 3 days
#
# What it does:
#   1. Moves old memory/*.md session logs → memory/archive/YYYY-MM/
#   2. Deletes empty stub files (≤5 lines, just session headers with no conversation)
#   3. Preserves .gitkeep and any non-date-prefixed files
#
# Safe to run multiple times (idempotent).

set -euo pipefail

WORKSPACE_ROOT="$(cd "$(dirname "$0")" && pwd)"
MEMORY_DIR="$WORKSPACE_ROOT/memory"
ARCHIVE_DIR="$MEMORY_DIR/archive"

# Parse arguments
DRY_RUN=false
RETENTION_DAYS=7

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    [0-9]*) RETENTION_DAYS="$arg" ;;
  esac
done

# Ensure memory directory exists
if [ ! -d "$MEMORY_DIR" ]; then
  echo "ERROR: memory/ directory not found at $MEMORY_DIR"
  exit 1
fi

echo "Memory cleanup — retention: ${RETENTION_DAYS} days, dry-run: ${DRY_RUN}"
echo "---"

ARCHIVED=0
DELETED=0
SKIPPED=0
CUTOFF_DATE=$(date -v-${RETENTION_DAYS}d +%Y-%m-%d 2>/dev/null || date -d "-${RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null)

echo "Cutoff date: $CUTOFF_DATE (files dated before this will be processed)"
echo ""

for filepath in "$MEMORY_DIR"/*.md; do
  [ -f "$filepath" ] || continue

  filename=$(basename "$filepath")

  # Skip non-date-prefixed files
  if ! echo "$filename" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}'; then
    continue
  fi

  # Extract date from filename (YYYY-MM-DD)
  file_date=$(echo "$filename" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
  file_month=$(echo "$file_date" | cut -d- -f1-2)  # YYYY-MM

  # Check if file is older than retention period
  if [[ "$file_date" > "$CUTOFF_DATE" || "$file_date" == "$CUTOFF_DATE" ]]; then
    SKIPPED=$((SKIPPED + 1))
    continue
  fi

  # Check if it's a stub file (≤5 lines = just session header, no conversation)
  line_count=$(wc -l < "$filepath" | tr -d ' ')

  if [ "$line_count" -le 5 ]; then
    # Delete empty stubs
    if [ "$DRY_RUN" = true ]; then
      echo "DELETE (stub, ${line_count}L): $filename"
    else
      rm "$filepath"
      echo "Deleted stub: $filename"
    fi
    DELETED=$((DELETED + 1))
  else
    # Archive conversation logs
    archive_subdir="$ARCHIVE_DIR/$file_month"

    if [ "$DRY_RUN" = true ]; then
      echo "ARCHIVE → archive/$file_month/: $filename (${line_count}L)"
    else
      mkdir -p "$archive_subdir"
      mv "$filepath" "$archive_subdir/$filename"
      echo "Archived: $filename → archive/$file_month/"
    fi
    ARCHIVED=$((ARCHIVED + 1))
  fi
done

echo ""
echo "---"
echo "Summary: $ARCHIVED archived, $DELETED deleted (stubs), $SKIPPED skipped (within retention)"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "(dry-run — no files were actually moved or deleted)"
fi
