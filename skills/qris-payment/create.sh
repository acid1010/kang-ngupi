#!/bin/bash
# QRIS Payment Creator
# Usage:
#   Single item:  ./create.sh "<phone>" "<name>" "<items_json>" "<fulfillment>" "<shareloc>"
#   items_json:   JSON array, e.g. '[{"name":"Es Kopi Susu Original","quantity":2},{"name":"Americano","quantity":1}]'
#
# Example:
#   ./create.sh "+6285155022960" "Dodo" '[{"name":"Es Kopi Susu Original","quantity":1}]' "delivery" "-6.575756, 107.464066"

set -euo pipefail

PHONE="${1:?phone required}"
NAME="${2:?name required}"
ITEMS_JSON="${3:?items_json required}"
FULFILLMENT="${4:-delivery}"
SHARELOC="${5:-}"

# Build JSON payload safely with jq
JSON=$(jq -n \
  --arg phone "$PHONE" \
  --arg name "$NAME" \
  --argjson items "$ITEMS_JSON" \
  --arg fulfillment "$FULFILLMENT" \
  --arg shareloc "$SHARELOC" \
  '{
    customer_phone: $phone,
    customer_name: $name,
    items: $items,
    fulfillment_method: $fulfillment,
    shareloc: $shareloc
  }')

# Call backend
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST http://localhost:3001/payments/qris/direct \
  -H "Content-Type: application/json" \
  -d "$JSON" 2>/dev/null) || true

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
  ERROR=$(echo "$BODY" | jq -r '.message // .error // "unknown"' 2>/dev/null || echo "unknown")
  echo "Maaf kak, ada kendala sebentar. Aku coba lagi ya."
  echo "DEBUG_ERROR: HTTP $HTTP_CODE - $ERROR" >&2
  exit 1
fi

# Parse response with jq
QR_URL=$(echo "$BODY" | jq -r '.qr_image_url // empty')
TOTAL=$(echo "$BODY" | jq -r '.total_payment // empty')

if [ -z "$QR_URL" ]; then
  echo "Maaf kak, ada kendala sebentar. Aku coba lagi ya."
  echo "DEBUG_ERROR: missing qr_image_url in response" >&2
  exit 1
fi

# Format total with Indonesian thousand separator
if [ -n "$TOTAL" ]; then
  TOTAL_FMT=$(printf "%.0f" "$TOTAL" | sed ':a;s/\B[0-9]\{3\}\>/.&/;ta')
else
  TOTAL_FMT="—"
fi

# Output ready-to-send message
echo "MEDIA: $QR_URL"
echo "Siap kak $NAME, ini QRIS-nya. Total Rp$TOTAL_FMT. Verifikasi otomatis ya kak 🙂"
