# Architecture — SobatNgupi Agent Workspace

## Overview

SobatNgupi is a WhatsApp-based coffee shop assistant for Kedai Ngupi Ngupi Purwakarta. It runs on the OpenClaw agent platform. The workspace contains configuration files that define the agent's behavior — there is no application code here.

## Components

### Core Prompt Files (define agent behavior)
- **SOBATNGUPI_PROMPT.md** — Main production prompt: persona, order flow, payment rules, QRIS procedure, reservation handling, complaint flow, sync milestones. This is the most important file.
- **AGENTS.md** — Auto-loaded by OpenClaw at session start. Contains critical rule reinforcements and cross-references to detailed docs. Must be concise.
- **SOUL.md** — Minimal identity declaration. Lists mandatory startup files to read.
- **IDENTITY.md** — Agent personality template (OpenClaw framework).

### Knowledge Files (reference data)
- **MEMORY.md** — Long-term memory: business facts, operational learnings, known issues.
- **menu-schema.json** — Machine-readable menu with aliases, quantity tokens, hot/ice tokens.
- **ORDER_SYNC.md** — State/outbox sync documentation: schemas, milestones, field specs.
- **TOOLS.md** — Backend endpoint documentation and known issues.
- **llms_pakasir.txt** — Pakasir payment gateway API reference.

### State Management (order tracking)
- `state/orders-active/` — Active order JSON files keyed by customer phone
- `state/orders-expired/` — Expired orders
- `state/reservations-active/` — Active reservations
- `outbox/order-context/` — Outbox snapshots for backend processing
- `outbox/reservation-context/` — Reservation outbox

### Skills (agent procedures)
- `skills/` — Procedure files the agent can invoke

## Data Flow

```
Customer (WhatsApp) → OpenClaw Platform → SobatNgupi Agent
    │
    ├── Reads: AGENTS.md (auto), SOBATNGUPI_PROMPT.md, MEMORY.md, menu-schema.json
    ├── Writes: state/orders-active/<phone>.json (order state)
    ├── Writes: outbox/order-context/<snapshot>.json (for backend)
    ├── Calls: curl POST localhost:3001/bridge/order-context (QRIS trigger)
    │
    └── Backend (localhost:3001) → generates QRIS → sends QR to WhatsApp
```

## Key Invariants

- AGENTS.md is auto-loaded first — must contain critical rules that need reinforcement
- Order flow: items → confirm → WAIT → payment (confirmation and payment NEVER in same message)
- QRIS is triggered via /bridge/order-context (not the deprecated /payments/qris/direct)
- Field naming: quantity (not qty), menuName (not name), menuId
- Shareloc: object {lat, lng, label?, source?} (not string)
- Agent never exposes technical terms to customers (backend, curl, exec, API, etc.)

## File Loading Order (OpenClaw)

1. AGENTS.md — auto-loaded at session start
2. Agent reads SOUL.md → which tells it to read SOBATNGUPI_PROMPT.md, MEMORY.md, ORDER_SYNC.md
3. Agent reads additional files as needed (menu-schema.json, TOOLS.md)
