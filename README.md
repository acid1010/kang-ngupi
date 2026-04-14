# ☕ SobatNgupi

AI-powered WhatsApp assistant for **Kedai Ngupi Ngupi Purwakarta** — handles orders, payments (QRIS/COD), delivery coordination, reservations, and complaints, all through natural conversation.

> *"Kayak barista langganan yang udah hapal pesananmu, ramah tapi nggak lebay, dan selalu bikin suasana enak."*

## Architecture

```
Customer (WhatsApp)
     │
     ▼
┌─────────────────────────────────────────────┐
│  OpenClaw Agent Platform                    │
│  ┌───────────────────────────────────────┐  │
│  │  SobatNgupi AI Agent                  │  │
│  │  - SOBATNGUPI_PROMPT.md (behavior)    │  │
│  │  - SOUL.md (voice & tone)             │  │
│  │  - menu-schema.json (menu & prices)   │  │
│  │  - MEMORY.md (learnings)              │  │
│  └──────────────┬────────────────────────┘  │
│                 │ exec tool                  │
│                 ▼                            │
│  ┌───────────────────────────────────────┐  │
│  │  sync-state.js (CLI bridge)           │  │
│  │  Reads local state → POSTs to backend │  │
│  └──────────────┬────────────────────────┘  │
└─────────────────┼───────────────────────────┘
                  │ HTTPS
                  ▼
┌─────────────────────────────────────────────┐
│  Backend (Express.js @ ngupingupi.me)       │
│  - Bridge: order state machine              │
│  - Payments: Pakasir QRIS gateway           │
│  - Queue: local file-based order queue      │
│  - Notifications: WhatsApp via wacli        │
│  - Database: Supabase (PostgreSQL)          │
└─────────────────────────────────────────────┘
```

## Project Structure

```
workspace-sobatngupi/
├── SOBATNGUPI_PROMPT.md      # Main production prompt (order flow, rules)
├── AGENTS.md                 # Critical rules (auto-loaded by OpenClaw)
├── SOUL.md                   # Voice, tone & personality
├── IDENTITY.md               # Agent identity card
├── MEMORY.md                 # Long-term memory & learnings
├── TOOLS.md                  # Backend tool documentation
├── ORDER_SYNC.md             # State sync specification
├── menu-schema.json          # Menu items, prices & aliases
├── cleanup-memory.sh         # Session log archival script
│
├── state/
│   ├── orders-active/        # Active order per customer (phone.json)
│   ├── orders-expired/       # Stale orders (>24h)
│   └── reservations-active/  # Active reservations
│
├── outbox/
│   ├── order-context/        # Snapshots for backend processing
│   └── reservation-context/  # Reservation snapshots
│
├── memory/                   # Session conversation logs
│   └── archive/              # Archived old logs (by month)
│
└── backend/
    ├── sync-state.js         # CLI bridge (agent exec → backend API)
    ├── .env                  # Environment config (not committed)
    ├── ecosystem.config.cjs  # PM2 process config
    ├── package.json
    └── src/
        ├── index.js          # Express server (port 3001)
        ├── bridge/           # Order state evaluator
        ├── payments/         # QRIS payment service + poller
        ├── queue/            # Local file-based order queue
        ├── outbox/           # Outbox snapshot processor
        ├── notifications/    # WhatsApp delivery (wacli)
        ├── catalog/          # Menu pricing engine
        ├── builders/         # Order payload builders
        ├── repositories/     # Supabase DAL (orders, payments)
        ├── state/            # Local state file management
        └── lib/              # Logger, config
```

## Menu

| Item | Price | Popular aliases |
|------|-------|-----------------|
| Es Kopi Susu Original | Rp17.000 | kopsu, kopi susu |
| Americano | Rp15.000 | amer |
| Caffe Latte | Rp21.000 | latte |
| Cappuccino | Rp21.000 | cap |
| Matcha Latte | Rp22.000 | matcha |
| Chocolate | Rp18.000 | coklat |
| Teh | Rp10.000 | tea, teh manis |

## Order Flow

```
1. Capture items → 2. Confirm order → 3. WAIT for approval
→ 4. Pickup/Delivery → 5. Location (if delivery)
→ 6. Payment method (SEPARATE message!) → 7. Process payment
```

Key rules:
- Payment question **must be in a separate message** from fulfillment/location
- Pickup → QRIS only (no COD)
- Delivery → QRIS or COD
- Customer name must be collected before anything else

## QRIS Payment Flow

```
Customer says "QRIS"
  → Agent writes state file (paymentMethod: qris)
  → Agent exec: node backend/sync-state.js sync +62xxx
  → Script POSTs to backend bridge
  → Backend creates QRIS via Pakasir API
  → Backend sends QR image to WhatsApp via wacli
  → Customer scans & pays
  → Pakasir webhook → backend verifies → success notification
```

## Setup

### Prerequisites

- Node.js 22+
- PM2 (`npm i -g pm2`)
- [wacli](https://github.com/nicejuerry/wacli) (WhatsApp CLI)
- Supabase project
- Pakasir account (QRIS gateway)

### Backend Setup

```bash
# 1. Install dependencies
cd backend && npm install

# 2. Configure environment
cp .env.example .env
# Fill in: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
#          PAKASIR_PROJECT_SLUG, PAKASIR_API_KEY,
#          BACKEND_API_KEY, PAKASIR_WEBHOOK_SECRET

# 3. Start with PM2
pm2 start ecosystem.config.cjs
pm2 save

# 4. Verify
curl http://localhost:3001/health
# → {"ok":true,"service":"ngupi-backend"}
```

### Agent Setup (OpenClaw)

The agent reads configuration from root-level markdown files. No additional setup needed — OpenClaw auto-loads `AGENTS.md` at session start, which references all other files.

## Maintenance

### Memory Cleanup

Session logs in `memory/` grow over time. Use the cleanup script:

```bash
./cleanup-memory.sh              # Archive logs older than 7 days
./cleanup-memory.sh 14           # Archive logs older than 14 days
./cleanup-memory.sh --dry-run    # Preview only

# Auto-cleanup via cron (daily at 3 AM):
0 3 * * * cd ~/workspace-sobatngupi && ./cleanup-memory.sh
```

### Useful Commands

```bash
# Check payment status
node backend/sync-state.js status +62xxxxxxxxxx

# Trigger QRIS sync manually
node backend/sync-state.js sync +62xxxxxxxxxx

# Process failed queue items
npm run queue:retry-failed --prefix backend

# View backend logs
pm2 logs ngupi-backend
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Agent platform | [OpenClaw](https://openclaw.ai) |
| Channel | WhatsApp (via wacli) |
| Backend | Node.js, Express 5 |
| Database | Supabase (PostgreSQL) |
| Payments | [Pakasir](https://app.pakasir.com) (QRIS) |
| Process manager | PM2 |
| Hosting | Ubuntu VPS |

## License

Private — Kedai Ngupi Ngupi Purwakarta
