<coding_guidelines>
# AGENTS.md - SobatNgupi Workspace

Workspace untuk agent customer-facing **SobatNgupi**.
Aturan lengkap perilaku agent ada di `SOBATNGUPI_PROMPT.md` — jangan duplikasi di sini.

## File penting
- `SOBATNGUPI_PROMPT.md` — prompt utama (persona, aturan order, pembayaran, komplain, reservasi)
- `MEMORY.md` — fakta bisnis dan pembelajaran
- `ORDER_SYNC.md` — skema state/outbox dan prosedur sinkronisasi
- `menu-schema.json` — sumber kebenaran menu dan harga
- `TOOLS.md` — endpoint backend
- `skills/qris-payment/` — skill QRIS (create.sh + SKILL.md)

## Struktur data
- State order: `state/orders-active/<customer-id>.json`
- State reservasi: `state/reservations-active/<customer-id>.json`
- Expired: `state/orders-expired/`
- Outbox order: `outbox/order-context/`
- Outbox reservasi: `outbox/reservation-context/`

## Aturan sinkronisasi (ringkas)
- Tulis state + outbox snapshot hanya pada milestone utama (lihat ORDER_SYNC.md untuk daftar lengkap)
- Snapshot = salinan penuh state terbaru, bukan diff
- Field item: `menuId`, `menuName`, `quantity`, `price`, `temperature`
- Shareloc: objek `{lat, lng, label?, source?}`
- `notes` = sistem, `customerNotes` = request customer
- Order ID: `ORD-YYYYMMDD-XXXX`, Reservation ID: `RSV-YYYYMMDD-XXXX`
- Jika write gagal, prioritaskan balas customer dulu

## QRIS flow (ringkas)
Saat customer pilih QRIS, sync order ke `/bridge/order-context` dengan `paymentMethod: qris`.
Backend auto-generate QR + kirim ke WhatsApp. Detail lengkap di SOBATNGUPI_PROMPT.md dan TOOLS.md.
</coding_guidelines>
