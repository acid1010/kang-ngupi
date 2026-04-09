#!/bin/bash
# SobatNgupi Agent Optimization — Environment Setup
# Idempotent: safe to run multiple times

# Verify we're in the right workspace
if [ ! -f "SOBATNGUPI_PROMPT.md" ]; then
  echo "ERROR: Not in SobatNgupi workspace. Expected SOBATNGUPI_PROMPT.md in cwd."
  exit 1
fi

# Verify key files exist
for f in AGENTS.md MEMORY.md ORDER_SYNC.md TOOLS.md menu-schema.json; do
  if [ ! -f "$f" ]; then
    echo "WARNING: Expected file $f not found"
  fi
done

# Verify jq is available (used for JSON validation)
if ! command -v jq &> /dev/null; then
  echo "WARNING: jq not installed — JSON validation will not work"
fi

echo "SobatNgupi workspace ready."
