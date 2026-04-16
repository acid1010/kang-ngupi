# SobatNgupi — Kedai Kopi Ngupi Ngupi

WhatsApp-based coffee shop ordering system with POS integration, QRIS payments, and delivery management.

## Architecture

```
Customer (WhatsApp) → OpenClaw Gateway → SobatNgupi Agent
                                              ↓
                                    Backend API (Express)
                                    ├── QRIS Payments (Pakasir)
                                    ├── POS Integration (Pawoon)
                                    ├── Courier Notifications (wacli)
                                    ├── Dashboard API (JWT + SSE)
                                    └── Supabase (PostgreSQL)
                                              ↓
                                    Dashboard (Next.js) → ngupingupi.me/app
```

## Stack

| Component | Tech |
|-----------|------|
| AI Agent | OpenClaw + Claude Opus 4.6 |
| WhatsApp | OpenClaw WhatsApp plugin + wacli |
| Backend | Node.js + Express |
| Database | Supabase (PostgreSQL) |
| Payments | Pakasir (QRIS) |
| POS | Pawoon OpenAPI |
| Dashboard | Next.js 15 (standalone) |
| Process Manager | PM2 |
| Reverse Proxy | Nginx + Let's Encrypt |

## Directory Structure

```
workspace-sobatngupi/
├── SOBATNGUPI_PROMPT.md    # Agent persona & order flow rules
├── AGENTS.md               # Agent configuration
├── SOUL.md                 # Persona voice & tone
├── TOOLS.md                # Backend scripts documentation
├── ORDER_SYNC.md           # State machine & sync protocol
├── menu-schema.json        # Menu items (synced from Pawoon)
├── AUDIT-2026-04-16.md     # Security & reliability audit
│
├── backend/
│   ├── src/
│   │   ├── index.js                 # Main Express server
│   │   ├── supabase.js              # DB client (singleton)
│   │   ├── bridge/
│   │   │   ├── stateService.js      # Order state management
│   │   │   └── evaluator.js         # Auto QRIS creation
│   │   ├── payments/
│   │   │   ├── service.js           # Payment verification + webhooks
│   │   │   ├── pakasir.js           # Pakasir API client
│   │   │   └── poll.js              # Payment poller (adaptive)
│   │   ├── notifications/
│   │   │   ├── whatsapp.js          # QR image + success notifications
│   │   │   ├── courier.js           # Delivery courier alerts
│   │   │   ├── feedback.js          # Post-delivery rating system
│   │   │   └── alerting.js          # Admin error alerts
│   │   ├── integrations/
│   │   │   └── pawoon.js            # Pawoon POS order push
│   │   ├── dashboard/
│   │   │   ├── index.js             # Dashboard router
│   │   │   ├── auth.js              # JWT auth (bcrypt)
│   │   │   └── orders.js            # Orders API + SSE realtime
│   │   ├── catalog/
│   │   │   └── menuPricing.js       # Menu price resolution
│   │   └── repositories/
│   │       ├── orders.js            # Order CRUD
│   │       └── payments.js          # Payment CRUD
│   │
│   ├── sync-state.js               # CLI: sync agent state → backend
│   ├── order-history.js            # CLI: query order history
│   ├── pawoon-sync-menu.js         # CLI: sync menu from Pawoon
│   ├── expire-orders.js            # Cron: expire stale orders
│   ├── cancel-unpaid.js            # Cron: cancel unpaid QRIS
│   ├── update-wacli.sh             # Cron: auto-update wacli
│   ├── seed-admin.js               # Setup: create dashboard admin
│   ├── ecosystem.config.cjs        # PM2 configuration
│   └── .env                        # Environment variables
│
├── dashboard/                      # Next.js 15 dashboard
│   ├── src/app/
│   │   ├── login/                  # Login page
│   │   └── dashboard/              # Main dashboard
│   │       ├── orders/             # Order management
│   │       └── users/              # User management (admin)
│   └── .next/standalone/           # Production build (54MB)
│
├── state/
│   ├── orders-active/              # Current order state files
│   └── orders-expired/             # Archived orders
│
└── memory/                         # Agent memory & learnings
```

## Features

### Customer Flow (WhatsApp)
- Natural language ordering in Bahasa Indonesia
- Menu browsing by category (63 items from Pawoon)
- Alias support (kopsu, amer, matcha, etc.)
- QRIS payment with auto-generated QR code
- COD payment for delivery
- Delivery with shareloc + Google Maps link
- Order history & repeat orders
- Post-delivery feedback/rating (1-5 stars)

### Payment (QRIS)
- Auto-generate QR via Pakasir API
- QR image sent to customer via WhatsApp (wacli)
- Dual verification: webhook (instant) + poller (15s backup)
- Dedup protection at every level
- Auto-cancel unpaid orders after 1 hour

### POS Integration (Pawoon)
- Daily menu sync (cron 06:00 WIB)
- Auto-push confirmed orders to Pawoon POS
- Sales type mapping (delivery/pickup)

### Dashboard (ngupingupi.me/app)
- JWT authentication (admin/kurir roles)
- Realtime order updates (SSE)
- Order status management (8-step delivery flow)
- Stats: total today, pending, on the way, completed
- Mobile-optimized (PWA-ready)

### Notifications
- Customer: QR code, payment confirmation
- Courier: Order details + Google Maps link
- Admin: Error alerts (throttled)
- Feedback: Rating request after delivery

### Automation (Cron Jobs)
| Job | Schedule | Description |
|-----|----------|-------------|
| expire-stale-orders | Hourly | Move orders >24h to expired |
| cancel-unpaid-orders | Every 30min | Cancel QRIS pending >1hr |
| pawoon-menu-sync | Daily 06:00 | Sync menu from Pawoon POS |
| wacli-auto-update | Weekly Mon 04:00 | Build wacli from source |

## Setup

### Prerequisites
- Node.js 22+
- Go 1.22+ (for wacli build)
- PM2
- Nginx + SSL
- Supabase project
- Pakasir account
- Pawoon POS account
- OpenClaw gateway

### Environment Variables
```bash
# Backend (.env)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
PAKASIR_BASE_URL=https://app.pakasir.com
PAKASIR_PROJECT_SLUG=
PAKASIR_API_KEY=
PAKASIR_WEBHOOK_SECRET=
PAWOON_CLIENT_ID=
PAWOON_CLIENT_SECRET=
PAWOON_OUTLET_ID=
PAWOON_BASE_URL=https://open-api.pawoon.com
WHATSAPP_SEND_QRIS_ON_CREATE=true
WHATSAPP_NOTIFY_QRIS_SUCCESS=true
PAYMENT_POLL_INTERVAL_MS=15000
COURIER_PHONES=+62xxx,+62yyy
ADMIN_ALERT_PHONE=+62xxx
DASHBOARD_JWT_SECRET=
BACKEND_API_KEY=
```

### Quick Start
```bash
# Install dependencies
cd backend && npm install

# Create dashboard admin
node seed-admin.js <username> <password> <name>

# Start services
pm2 start ecosystem.config.cjs

# Build & start dashboard
cd dashboard && npm run build
pm2 start .next/standalone/server.js --name ngupi-dashboard
```

## API Endpoints

### Backend (port 3001)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | ❌ | Health check + DB status |
| POST | /bridge/order-context | API Key | Sync order state |
| POST | /payments/qris/direct | API Key | Create QRIS payment |
| POST | /webhooks/pakasir | Webhook Secret | Payment webhook |
| POST | /payments/poll-pending | API Key | Manual poll trigger |

### Dashboard API (port 3001, path /dashboard/api)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/login | ❌ | Login → JWT |
| GET | /auth/me | JWT | Current user |
| POST | /auth/users | JWT (admin) | Create user |
| GET | /orders | JWT | List orders |
| GET | /orders/:id | JWT | Order detail |
| PATCH | /orders/:id/status | JWT | Update status |
| GET | /orders/stats/summary | JWT | Dashboard stats |
| GET | /orders/stream | JWT | SSE realtime |
| GET | /feedback | JWT | Rating list |

## Order Status Flow
```
awaiting_payment → ready_to_submit → preparing → ready_for_pickup
→ picked_up → on_the_way → delivered → completed
```

## Security
- bcrypt password hashing (auto-migrated from SHA-256)
- Rate limiting (login: 5/min, API: 100/min, webhooks: 30/min)
- CORS restricted to ngupingupi.me
- .env file permissions 600
- JWT with 7-day expiry
- API key authentication for backend endpoints
- Pakasir webhook secret verification

## Monitoring
- Health endpoint: `GET /health` (DB + uptime + memory)
- PM2 log rotation (10MB max, 7 days retain)
- Admin WA alerts on critical errors
- Heartbeat checks via OpenClaw

## License
Private — Kedai Kopi Ngupi Ngupi © 2026
