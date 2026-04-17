# Kang Ngupi Long-Term Memory

File ini menyimpan fakta, keputusan, dan pembelajaran yang melengkapi prompt utama (SOBATNGUPI_PROMPT.md).
Jangan duplikasi aturan yang sudah ada di SOBATNGUPI_PROMPT.md atau AGENTS.md — cukup referensikan.

## Identitas & Bisnis
- Nama agent: Kang Ngupi
- Bisnis: Kedai Ngupi Ngupi Purwakarta
- Alamat: Jl. K.K. Singawinata No.9, Purwakarta, Jawa Barat
- Jam operasional: 09:00-17:00 WIB
- Instagram: @kedaingupingupi
- Channel: WhatsApp
- Owner/Admin: Acid (+6283872201310)

## Keputusan desain
- `notes` = catatan sistem internal; `customerNotes` = request customer (less ice, dll)
- Shareloc disimpan sebagai objek `{lat, lng, label?, source?}`, bukan string
- Item schema: `menuId`, `menuName`, `quantity`, `price`, `temperature`
- Order ID format: `ORD-YYYYMMDD-XXXX` (hex), dibuat saat items_captured
- Reservation ID format: `RSV-YYYYMMDD-XXXX` (hex)

## Cron Jobs
- `cancel-unpaid-orders` — every :15 and :45, auto-cancel QRIS unpaid >1hr
- `expire-stale-orders` — hourly, move stale orders >24h to expired
- `pawoon-menu-sync` — daily 06:00 WIB, sync menu from Pawoon
- `wacli-auto-update` — weekly Monday 04:00 WIB, rebuild wacli from source

## Menu Images
- 76 images downloaded from Pawoon → `backend/public/menu-images/`
- Served via Express static at `/menu-images/`
- Script: `backend/send-menu-image.js` — kirim foto menu ke customer via wacli
- Script: `backend/pawoon-sync-images.js` — download images from Pawoon
- Exclusive alias mapping: short aliases (kopsu, amer, latte) only map to 1 canonical item

## Integration Test
- Script: `backend/test-integration.js` — 17 tests covering full order flow
- Tests: health, state, sync, DB, payment, dashboard API, history, menu, wacli, Pawoon

---

## Bug Fixes (2026-04-17)

### Exec Preflight Block
- Agent pakai `cd ... && node ...` yang di-block oleh exec preflight
- Fix: semua script paths di prompt/TOOLS.md/AGENTS.md diganti ke absolute path

### Payment Poller Scope Bug (CRITICAL)
- `orderItems` di-declare dengan `const` di dalam courier `try` block
- Pawoon push + courier notification di bawahnya nggak bisa akses → silently fail
- Fix: `orderItems` di-fetch di scope lebih tinggi, shared antara courier + Pawoon
- Impact: semua paid order sebelumnya TIDAK push ke Pawoon dan TIDAK notify courier

### Pawoon Payment Method
- Pawoon API nggak kenal `qris` sebagai payment method
- Fix: semua payment method map ke `cash` untuk Pawoon
- NaN price juga di-fix dengan `Number()` cast

### Notes Field Corruption
- Agent nulis `notes` sebagai string → di-spread jadi array of individual characters
- Fix: sanitize di sync-state.js dan orders.js — string auto-wrap ke array, filter 1-char artifacts

### QRIS Double Message
- Agent kirim "Sebentar ya" + "Cek chat ya kak" padahal backend sudah kirim QR + caption
- Fix: prompt updated — jika `whatsappSent: true`, agent DIAM (no reply)

### Dashboard Unpaid Orders
- Dashboard tampil semua order termasuk draft/pending
- Fix: default filter hanya tampil order yang sudah bayar (confirmed/paid/settled)

### Express Trust Proxy
- Rate limiter error `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` karena nginx forwards header
- Fix: `app.set('trust proxy', 1)`

### Order Not Found (QRIS Fallback)
- Queue processing nggak create order di DB → QRIS endpoint gagal
- Fix: fallback auto-create order dari orderContext jika nggak ada di DB
- Also fix `go_ngupi` → `ngupi_express` mapping untuk DB constraint

### Kentang Goreng Missing Price
- Menu sync cuma drinks (10 kategori) → food items nggak ada di menu-schema
- Fix: sync ALL 107 Pawoon products, bukan cuma drinks

### Dashboard Status Update Errors
- Kolom `picked_up_at`, `on_the_way_at`, `delivered_at` nggak ada di DB
- Fix: remove timestamp columns dari update, track via `updated_at`
- Dashboard crash setelah update: PATCH response nggak punya `items` → merge dengan existing

### Pakasir Webhook 401
- Webhook secret nggak dikirim oleh Pakasir
- Fix: user update webhook URL dengan `?webhook_secret=...`

### Dashboard Filter Bug
- Comma-separated status filter pakai `eq` bukan `in`
- Fix: detect comma → split → `in` query

---

## Operational Learnings

### QRIS Payment Gotchas

**QR tidak terkirim / customer bilang "mana qris nya":**
- Artinya backend belum push QR image ke WhatsApp — customer tidak melihat apa-apa
- agent Harus langsung eksekusi exec tool untuk generate QRIS, bukan cuma bilang "sedang disiapkan"
- Jika exec gagal → jangan bilang "kendala teknis" ke customer, cukup bilang "Coba lagi sebentar ya kak"
- Follow up hanya 1x jika QR belum muncul setelah >15 menit

**Expired QR reuse (backend bug):**
- Backend reusing expired QR from previous order when fresh QR not generated
- Workaround: call `/bridge/order-context` with fresh items to regenerate QR
- QRIS timeout → tawarkan generate ulang (delivery only) atau switch ke COD

### Order Flow Insights

**Soft reconfirm untuk nama lama:**
- Jika customer sudah punya nama di state, gunakan soft reconfirm: "Masih atas nama [Nama] ya kak?"
- Jangan otomatis pakai nama lama tanpa konfirmasi di order baru

**Mid-flow modifikasi:**
- Customer ubah qty / hapus / tambah item → update + konfirmasi ulang
- Setelah konfirmasi order → harus konfirmasi ulang dulu sebelum tanya pembayaran

**"cap" ambigu:**
- "cap" bisa berarti Cappuccino atau Capture (screenshot bukti bayar)
- Selalu klarifikasi: "Yang dimaksud cappuccino ya kak?"

### Alias Handling Insights

- `kopsu` → Es Kopi Susu Original
- `amer` / `ameri` → Americano
- `coklat` / `cokelat` → Chocolate
- `latte` → Caffe Latte
- `matcha` → Matcha Latte
- `teh` → Teh
- Jika alias ambigu → langsung klarifikasi

### Go Ngupi / Ongkir
- Ongkir calculator: `backend/calculate-ongkir.js` — Haversine distance, 3 zona
- Kedai coords: -6.5519552, 107.4451273
- Max delivery: 8km
- Zona 1 (0-2km): Rp8.000, Zona 2 (2-5km): +Rp2K/km, Zona 3 (5-8km): +Rp3K/km
- Go Ngupi branding integrated ke WA chat flow

### Customer Status Notifications
- `backend/src/notifications/status.js` — WA notif setiap status berubah
- preparing: "Pesanan sedang dibuat"
- on_the_way: "Sedang diantar kurir Go Ngupi"
- ready_for_pickup: "Sudah siap, silakan diambil"
- completed: "Pesanan selesai, terima kasih"

### Dashboard Simplified Flow
- 8 step → 3 step: preparing → on_the_way/ready_for_pickup → completed
- Button aksi otomatis sesuai delivery/pickup

### Formatting Preferences

- WhatsApp list: selalu pakai `- ` (minus + spasi), bukan `•` atau numbering
- Emoji hemat: 0-1 per pesan pendek; variatif: 🙂 😊 ✨ 🙏 👍 📍 🛵 🧾
- Jangan spam ☕ dalam pesan
