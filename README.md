# ☕ Kang Ngupi

**AI-Powered WhatsApp Ordering System for Coffee Shop**

Kang Ngupi is a production-grade AI assistant that handles the entire ordering flow for a physical coffee shop via WhatsApp — from menu browsing to payment processing to POS integration.

![Status](https://img.shields.io/badge/status-production--live-brightgreen)
![Stack](https://img.shields.io/badge/stack-Node.js%20%7C%20Next.js%20%7C%20Supabase-blue)

## 🎯 What It Does

- **Natural Language Ordering** — Customers chat in Bahasa Indonesia, bot understands context (dine-in, delivery, pickup)
- **QR Dine-In** — Scan table QR → auto-detect table number → order → pay
- **QRIS Payment** — Integrated with Doku payment gateway, auto-verify via webhook + polling
- **POS Integration** — Orders auto-push to Pawoon POS (cashier sees it instantly)
- **Delivery Management** — Distance-based pricing (Go Ngupi), courier notifications
- **Smart Features** — Upsell suggestions, idle chat nudging, auto-cancel unpaid orders

## 🏗️ Architecture

```
Customer (WhatsApp)
    ↓
OpenClaw Agent (GPT-5.4 / Claude Opus)
    ↓
Backend (Node.js + Express)
    ├── Doku QRIS Gateway
    ├── Pawoon POS API
    ├── Supabase (PostgreSQL)
    └── WhatsApp (wacli)
    ↓
Dashboard (Next.js 16 + React 19)
```

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Agent | OpenClaw + GPT-5.4 / Claude Opus 4.6 |
| Backend | Node.js, Express, ESM |
| Database | Supabase (PostgreSQL) |
| Payment | Doku QRIS (production) |
| POS | Pawoon Open API |
| Dashboard | Next.js 16, React 19, Tailwind CSS v4, shadcn/ui |
| WhatsApp | wacli (WhatsApp Web client) |
| Hosting | Ubuntu VPS, PM2, Nginx |

## ✨ Features

### Ordering Flow
- Multi-fulfillment: dine-in (QR table), delivery, pickup
- Menu browsing with 130+ items across 17 categories
- Variant handling (hot/cold, spice level, flavors)
- Auto-suggest upsell (complementary items)
- Order confirmation with smart formatting

### Payment
- Doku QRIS generation + auto-verification
- Webhook + polling dual-confirm
- Auto-cancel after 1 hour unpaid
- Payment reminder at 30 minutes

### POS Integration
- Auto-push to Pawoon on payment confirmed
- Table number mapping for dine-in
- Sales type routing (delivery/pickup/dine-in)
- Correct WIB timestamps

### Delivery (Go Ngupi)
- Distance-based pricing (Haversine formula)
- Max 8km radius
- Courier WhatsApp notification on confirmed orders
- Shareloc-based location

### Dashboard (Go Ngupi Courier)
- Realtime order updates (SSE)
- 2-step status: Sedang Diantar → Selesai
- Search by customer name/phone
- Notification sound on new orders
- Dark-teal branded theme

### Operations
- Pawoon menu sync (2x daily)
- Daily sales report (auto-send to admin)
- Idle chat nudging (15min reminder, 30min auto-cancel)
- Customer profile tracking
- Reservation system

## 📁 Project Structure

```
├── AGENTS.md          # AI agent instructions & rules
├── SOUL.md            # Bot personality & voice
├── menu-schema.json   # Full menu (synced from Pawoon)
├── backend/
│   ├── src/
│   │   ├── integrations/  # Pawoon POS
│   │   ├── payments/      # Doku QRIS
│   │   ├── notifications/ # WhatsApp, courier
│   │   ├── scheduler/     # Cron jobs, idle nudge
│   │   ├── dashboard/     # Dashboard API
│   │   └── bridge/        # Order state management
│   ├── sync-state.js      # QRIS sync orchestrator
│   ├── calculate-ongkir.js
│   ├── daily-report.js
│   └── reservasi.js
├── dashboard/             # Next.js 16 courier dashboard
├── state/                 # Runtime state files
│   ├── orders-active/
│   ├── customers/
│   └── doku-pending/
└── docs/
```

## 🚀 Getting Started

```bash
# Clone
git clone https://github.com/acid1010/kang-ngupi.git
cd kang-ngupi

# Backend
cd backend
cp .env.example .env  # Configure your keys
npm install
npm start

# Dashboard
cd dashboard
npm install
npm run build
npm start
```

## 📊 Production Stats

- **130** menu items synced from POS
- **20** table QR codes for dine-in
- **<3s** average response time
- **24/7** automated ordering (with business hour awareness)

## 🔒 Security

- Prompt injection protection (AGENTS.md rules)
- API key authentication for all backend endpoints
- No customer data exposed to AI model
- Rate limiting on payment endpoints
- Webhook signature verification (Doku)

## 📄 License

MIT

---

Built with ☕ by [acid1010](https://github.com/acid1010) — powered by [OpenClaw](https://github.com/openclaw/openclaw)
