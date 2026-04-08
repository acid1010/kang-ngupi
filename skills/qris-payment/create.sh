#!/bin/bash
# QRIS Payment Creator
# Usage: ./create.sh "<phone>" "<name>" "<menu>" <qty> "<fulfillment>" "<shareloc>"

PHONE="$1"
NAME="$2"
MENU="$3"
QTY="${4:-1}"
FULFILLMENT="${5:-delivery}"
SHARELOC="${6:-}"

# Build JSON payload
JSON=$(cat <<EOF
{"customer_phone":"$PHONE","customer_name":"$NAME","items":[{"name":"$MENU","quantity":$QTY}],"fulfillment_method":"$FULFILLMENT","shareloc":"$SHARELOC"}
EOF
)

# Call backend
RESPONSE=$(curl -s -X POST http://localhost:3001/payments/qris/direct \
  -H "Content-Type: application/json" \
  -d "$JSON" 2>/dev/null)

# Parse response
QR_URL=$(echo "$RESPONSE" | grep -o '"qr_image_url":"[^"]*"' | cut -d'"' -f4)
TOTAL=$(echo "$RESPONSE" | grep -o '"total_payment":[0-9]*' | cut -d':' -f2)

if [ -z "$QR_URL" ]; then
  echo "Maaf kak, ada kendala sebentar. Aku coba lagi ya."
  exit 1
fi

# Format total with Indonesian thousand separator
TOTAL_FMT=$(awk -v n="$TOTAL" 'BEGIN{n=sprintf("%.0f", n); s=""; while(length(n)>3){s="." substr(n, length(n)-2) s; n=substr(n,1,length(n)-3)}; print n s}')

# Output ready-to-send message
cat <<EOF
MEDIA: $QR_URL
Siap kak $NAME, ini QRIS-nya. Total Rp$TOTAL_FMT. Verifikasi otomatis ya kak 🙂
EOF
