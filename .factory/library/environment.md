# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## Platform

- **OpenClaw** — Agent platform that runs SobatNgupi. Auto-loads AGENTS.md at session start.
- **WhatsApp** — Customer communication channel (via ngrok tunnel)
- **Backend** — Node.js on localhost:3001. Handles QRIS payment generation, order processing.
- **Pakasir** — Payment gateway for QRIS. API documented in llms_pakasir.txt.

## Language

All agent-facing documentation is in **Indonesian (Bahasa Indonesia)**. Technical config files (JSON, YAML) are in English.

## Workspace Conventions

- File names: kebab-case for multi-word, UPPER_CASE.md for main docs
- State files: JSON, keyed by customer phone number
- Outbox: JSON snapshots at milestone transitions
- Memory: Session logs as markdown (being consolidated into MEMORY.md)
