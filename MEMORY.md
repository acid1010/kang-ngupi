# Kang Ngupi Long-Term Memory

## Identitas & Bisnis
- Bisnis: Kedai Ngupi Ngupi Purwakarta
- Alamat: Jl. K.K. Singawinata No.9, Purwakarta, Jawa Barat
- Jam: 09:00-17:00 WIB | Instagram: @kedaingupingupi
- Owner/Admin: Acid

## Cron Jobs
- `daily-sales-report` — 21:00 WIB
- `pawoon-menu-sync` — daily 09:00 WIB
- `wacli-auto-update` — weekly Monday 04:00 WIB

## Backend Scheduler (node-cron)
- QRIS remind 30min + cancel 1hr — */10 09-22 WIB
- Expire stale orders >24h — */6h
- Cleanup drafts — midnight

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
- Kedai coords: -6.5519552, 107.4451273
- Max 8km. Zona 1 (0-2km): Rp8K, Zona 2 (2-5km): +Rp2K/km, Zona 3 (5-8km): +Rp3K/km

## Model
- Production WA: openai-codex/gpt-5.4
- Admin Telegram: cpacid/cb-claude-opus-4-6
