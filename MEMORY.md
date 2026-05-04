# Kang Ngupi Long-Term Memory

## Identitas & Bisnis
- Bisnis: Kedai Ngupi Ngupi Purwakarta
- Alamat: Jl. K.K. Singawinata No.9, Purwakarta, Jawa Barat
- Jam Kang Ngupi (bot): Weekday 08:30-22:00, Weekend 07:30-22:30
- Jam Kedai (fisik): Weekday 09:00-23:00, Weekend 08:00-23:30
- Delivery cutoff: 21:00 WIB | Reservasi: ikut jam bot
- Instagram: @kedaingupingupi
- Owner/Admin: Acid

## Cron Jobs
- `stock-check-morning` — 10:00 WIB (Pawoon sync + report perubahan stok)
- `stock-check-evening` — 17:00 WIB (Pawoon sync + report perubahan stok)
- `daily-sales-report` — 21:00 WIB
- `wacli-auto-update` — weekly Monday 04:00 WIB

## Backend Scheduler (node-cron)
- QRIS remind 30min + cancel 1hr — */10 09-22 WIB
- Expire stale orders >24h — */6h
- Cleanup drafts — midnight

## Doku Payment Gateway
- Status: LIVE & TESTED ✅ (2026-05-04)
- Client ID: BRN-0298-1777690497551
- Merchant ID: 92624
- MPAN: 936008990000092624
- NMID: ID1026514758832
- Environment: production
- Endpoints: generate, query, cancel QRIS
- Webhook: https://ngupingupi.me/webhooks/doku (active)
- Poller: ngupi-doku-poller (PM2, 15s interval)
- RSA keys: backend/doku-private.key + doku-public-key.pem
- QRIS_PROVIDER=doku in .env
- Auto-verify: webhook (instant) + polling (backup)

## Pawoon
- Sales Type: SB-Delivery `995d3100-3a70-11f1-89d1-d1ccf556d896`, SB-Pickup `995dfb80-3a70-11f1-8056-5b0a4298eb41`
- Webhook: `POST /webhooks/pawoon` (log only)
- 130 products, 17 categories, 76 menu images

## Alias Mapping
- kopsu → Es Kopi Susu Original
- amer/ameri → Americano
- coklat/cokelat → Chocolate
- latte → Caffe Latte
- matcha → Matcha Latte
- teh → Teh
- cap → ambigu (cappuccino vs capture)

## Ongkir Go Ngupi
- Kedai coords: -6.551972, 107.445111
- Max 8km. Zona 1 (0-2km): Rp8K, Zona 2 (2-5km): +Rp2K/km, Zona 3 (5-8km): +Rp3K/km

## Dine-In Feature
- QR per meja → wa.me deep link → "Halo Kang Ngupi, saya di meja X nih!"
- 20 customer QR + 1 kasir QR: backend/public/table-qr/meja-{1-20}.png + kasir-1.png
- Pawoon sales type: Dine In (043381e0-3f20-11f1-b18b-0976115419c3)
- Open bill: customer nambah item berkali-kali, close bill kapan aja
- Payment: QRIS atau bayar di kasir (cash_at_counter)
- Cash at counter: auto-push ke Pawoon langsung
- QRIS: push ke Pawoon setelah payment confirmed
- Max unpaid: Rp200.000
- DB: table_number column added to orders table
- Per-phone billing (multi-customer per meja = separate bills)

## Model
- Production WA: openai-codex/gpt-5.4
- Admin Telegram: cpacid/cb-claude-opus-4-6
