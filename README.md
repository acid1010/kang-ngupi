# Kang Ngupi — Kedai Ngupi Ngupi Purwakarta

Sistem pemesanan digital via WhatsApp untuk Kedai Ngupi Ngupi Purwakarta.

## Stack

- **Agent:** OpenClaw + GPT-5.4
- **Backend:** Node.js, Express.js, PM2
- **Database:** Supabase (PostgreSQL)
- **Dashboard:** Next.js 15, React, Tailwind CSS
- **POS:** Pawoon Open API
- **Payment:** Pakasir (QRIS)
- **Messaging:** WhatsApp (wacli)

## Struktur

```
├── SOBATNGUPI_PROMPT.md   — prompt utama agent
├── SOUL.md                — persona & voice
├── AGENTS.md              — workspace config
├── MEMORY.md              — long-term memory
├── TOOLS.md               — backend endpoints
├── ORDER_SYNC.md          — state/outbox schema
├── IDENTITY.md            — agent identity
├── USER.md                — owner info
├── HEARTBEAT.md           — health check tasks
├── menu-schema.json       — menu data (auto-sync dari Pawoon)
│
├── backend/
│   ├── src/
│   │   ├── index.js           — Express server
│   │   ├── scheduler/         — internal cron (QRIS, expire, backup)
│   │   ├── payments/          — QRIS payment service
│   │   ├── bridge/            — agent ↔ backend bridge
│   │   ├── dashboard/         — dashboard API + SSE
│   │   ├── notifications/     — WA notifications (status, receipt, courier)
│   │   ├── integrations/      — Pawoon POS push
│   │   └── repositories/      — DB queries
│   ├── sync-state.js          — CLI bridge for agent
│   ├── daily-report.js        — daily sales report
│   ├── backup-customers.js    — customer data backup
│   ├── calculate-ongkir.js    — delivery fee calculator
│   ├── order-history.js       — order history lookup
│   ├── send-menu-image.js     — send menu photo via WA
│   └── pawoon-sync-menu.js    — menu sync from Pawoon
│
├── dashboard/                 — Next.js dashboard app
│   └── src/
│       ├── app/dashboard/     — order management
│       ├── app/login/         — auth
│       ├── components/        — UI components
│       └── lib/               — API + utils
│
├── state/                     — local order state files
├── outbox/                    — outbox snapshots
└── .learnings/                — self-improvement logs
```

## Fitur

- 💬 Pemesanan via WhatsApp (24/7, bahasa santai)
- 💳 QRIS otomatis (generate + verify + struk digital)
- 📊 Dashboard real-time (SSE, 3-step flow)
- 📱 Integrasi Pawoon POS (menu sync + order push)
- 🛵 Go Ngupi delivery (ongkir calculator, 3 zona)
- 🔔 Notifikasi status ke customer
- ⭐ Feedback & rating
- 📸 76 foto menu
- 📈 Daily sales report
- 🔒 Security hardening (Helmet, anti-injection, rate limiting)

## Scripts

```bash
# Sync state + trigger QRIS
node backend/sync-state.js sync +628xxx

# Check payment status
node backend/sync-state.js status +628xxx

# Daily sales report
node backend/daily-report.js

# Backup customer data
node backend/backup-customers.js

# Calculate delivery fee
node backend/calculate-ongkir.js <lat> <lng>

# Sync menu from Pawoon
node backend/pawoon-sync-menu.js

# Order history
node backend/order-history.js +628xxx [limit]

# Integration test
node backend/test-integration.js
```

## Deployment

```bash
# Backend
pm2 start backend/ecosystem.config.cjs

# Dashboard
cd dashboard && npm run build
pm2 restart ngupi-dashboard
```

## Links

- 🌐 Dashboard: https://ngupingupi.me/app
- 📱 WhatsApp: +62 877-8643-4813
- 📖 Docs: https://github.com/acid1010/kang-ngupi-docs
