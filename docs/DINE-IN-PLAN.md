# Dine-In Feature — Implementation Plan

## Overview
Customer scan QR di meja → buka WA → auto-send "Meja X" → Kang Ngupi handle order → push ke Pawoon with table info.

## Pawoon Setup (Acid perlu lakukan di dashboard.pawoon.com)
1. **Aktifkan sales type "Dine In"** atau buat baru "SB - Dine In"
2. **Setup meja** di Table Management (dashboard.pawoon.com/table-management)
   - Buat meja: Meja 1, Meja 2, ... Meja N
   - Note: API endpoint `/dining-tables` currently returns empty — meja belum di-setup

## QR Deep Link per Meja
Format: `https://wa.me/6285155022960?text=Meja%20{N}`
- Meja 1: `https://wa.me/6285155022960?text=Meja%201`
- Meja 2: `https://wa.me/6285155022960?text=Meja%202`
- dst.

QR code di-generate per meja, ditempel di meja. Customer scan → WA terbuka → auto-send "Meja 1".

## Agent Flow
1. Customer send "Meja 3" (dari QR scan)
2. Agent detect pattern "Meja \d+" → set `fulfillmentMethod: "dine_in"`, `tableNumber: 3`
3. Agent: "Halo kak, selamat datang di Meja 3! Mau pesan apa nih?"
4. Normal order flow (pilih menu → konfirmasi → QRIS)
5. Skip delivery/pickup question — langsung ke menu
6. Payment: QRIS only (no COD for dine-in)

## Backend Changes
1. `pawoon.js` — add dine-in sales type ID, include table info in order notes
2. `state/orders-active/*.json` — add `tableNumber` field
3. `AGENTS.md` — add dine-in flow rules
4. Dashboard — show table number in order card

## Pawoon Order Payload (dine-in)
```json
{
  "data": {
    "receipt_code": "NGUPI-230426-001",
    "outlet_id": "...",
    "company_sales_type_id": "<dine-in-sales-type-id>",
    "notes": "Meja 3 - WhatsApp Dine-In Order",
    "dining_table_id": "<from-pawoon-api>",  // if available
    "items": [...],
    "payment": { "amount": 18000, "method": "cash" }
  }
}
```

## QR Code Generation Script
`backend/generate-table-qr.js` — generate QR codes for all tables
Output: PNG files in `backend/public/table-qr/meja-1.png`, etc.

## Status
- [ ] Acid: Setup meja di Pawoon dashboard
- [ ] Acid: Aktifkan/buat sales type "SB - Dine In"
- [ ] Backend: Add dine-in support to pawoon.js
- [ ] Agent: Add dine-in flow to AGENTS.md
- [ ] Script: QR code generator per meja
- [ ] Dashboard: Show table number
