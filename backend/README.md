# Ngupi Backend

Backend awal untuk Kedai Ngupi Ngupi Purwakarta.

## Scope fase 1
- `POST /webhooks/orders`
- `POST /queue/orders`
- `POST /queue/process`
- `POST /queue/retry-failed`
- `POST /bridge/order-context`
- `GET /bridge/order-context/:phone`
- `GET /orders`
- `GET /orders/:id`
- `POST /payments/pakasir/qris`
- `GET /payments/:id`
- `GET /payments/:id/qr.png`
- `POST /webhooks/pakasir`
- target database: Supabase

## Setup
1. Copy `.env.example` ke `.env`
2. Isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY`
3. Install dependency:
   - `npm install`
4. Jalankan dev server:
   - `npm run dev`

## Endpoint
### POST /webhooks/orders
Menerima event:
- `draft_order`
- `final_order`

### POST /queue/orders
Menerima payload order yang sama seperti webhook, tetapi menyimpannya dulu ke folder queue lokal (`draft`/`final`). Jika `AUTO_PROCESS_QUEUE=true`, queue akan langsung diproses setelah enqueue.

Catatan proses queue:
- draft diproses lebih dulu, lalu final
- ini sengaja agar order dengan `client_order_id` yang sama tidak balapan saat masuk ke webhook
- jika draft order membawa `payment.method = qris` dan status pending, queue processor akan mencoba membuat payment session Pakasir otomatis setelah draft berhasil masuk ke webhook

### POST /queue/process
Memproses queue draft/final secara manual via HTTP.

### POST /queue/retry-failed
Memindahkan ulang semua file dari bucket `failed/` ke bucket yang sesuai (`draft` / `final`), lalu langsung memproses queue lagi.

### POST /bridge/order-context
Menerima update state order aktif per customer. Endpoint ini akan:
- merge update ke active state JSON store
- jika state lama sudah final enough dan update baru membawa item order yang valid, backend akan memulai state order baru untuk customer yang sama
- mengevaluasi apakah `draft_order` / `final_order` sudah layak dikirim
- enqueue event ke queue lokal jika readiness terpenuhi

### GET /bridge/order-context/:phone
Melihat state order aktif customer.

### GET /orders
List order terbaru beserta item order.

### GET /orders/:id
Ambil detail satu order.

### POST /payments/pakasir/qris
Membuat payment session QRIS Pakasir untuk order yang sudah ada (berdasarkan `client_order_id`). Endpoint ini akan:
- menghitung nominal order dari item order (atau pakai `amount` override jika dikirim)
- membuat transaksi QRIS via API Pakasir
- menyimpan payment session di database
- menyediakan URL gambar QR yang bisa dikirim ke customer
- mencoba mengirim gambar QR langsung ke WhatsApp customer via `wacli` sebagai best-effort jika nomor customer tersedia
- jika payment session pending yang sama diminta lagi, endpoint akan me-return payment lama dan mencoba resend QR ke WhatsApp

Contoh body:
```json
{
  "client_order_id": "draft_2026-04-03T22-21-13"
}
```

### GET /payments/:id
Ambil detail satu payment session termasuk `qr_image_url`.

### GET /payments/:id/qr.png
Menghasilkan gambar PNG QRIS langsung dari QR string yang diberikan Pakasir.

### POST /webhooks/pakasir
Menerima webhook dari Pakasir, lalu:
- verifikasi ulang status transaksi via `transactiondetail`
- update payment session menjadi `confirmed` jika valid
- update ringkasan payment di order
- update active state customer agar `final_order` bisa otomatis lanjut saat payment QRIS sudah terverifikasi
- kirim notifikasi WhatsApp langsung ke customer via `wacli` saat status pertama kali benar-benar berubah menjadi `confirmed`

## Example payload
```json
{
  "event_type": "draft_order",
  "order": {
    "client_order_id": "draft_20260402_001",
    "customer": {
      "name": "Rasyid",
      "phone": "+62xxxxxxxxxx"
    },
    "items": [
      { "menu_id": "kopi-susu-original", "menu_name": "Es Kopi Susu Original", "qty": 2 }
    ],
    "fulfillment": {
      "method": "delivery",
      "location_status": "shareloc_received",
      "shareloc": {
        "lat": -6.0,
        "lng": 107.0,
        "label": "Purwakarta",
        "source": "whatsapp"
      },
      "delivery_provider": "ngupi_express"
    },
    "payment": {
      "method": "cod",
      "status": "pending"
    },
    "status": "draft",
    "raw_message": "kopsu 2",
    "notes": [],
    "created_at": "2026-04-03T00:00:00+07:00"
  }
}
```

## Payload builder
Backend ini punya helper builder untuk membentuk payload order dengan format yang konsisten.

Lokasi:
- `src/builders/orderPayload.js`

Helper yang tersedia:
- `buildDraftOrderPayload(orderContext)`
- `buildFinalOrderPayload(orderContext)`
- `generateClientOrderId(prefix)`
- `normalizePhone(phone)`

Builder akan:
- memakai `client_order_id` yang sudah ada jika tersedia
- membuat `client_order_id` baru jika belum ada
- menormalisasi nomor customer ke format `+62...`
- merapikan notes
- memetakan items ke format payload final

## Outbox SobatNgupi → bridge
Backend ini juga bisa memproses outbox lokal dari workspace SobatNgupi.

Struktur outbox default:
- `/Users/acidjp/.openclaw/workspace-sobatngupi/outbox/order-context/`
- `processed/`
- `failed/`

Script yang tersedia:
- `npm run outbox:run` → proses outbox sekali
- `npm run outbox:watch` → scan outbox periodik lalu POST ke `/bridge/order-context`

Env tambahan:
- `BRIDGE_ORDER_CONTEXT_URL` (default: `http://localhost:3001/bridge/order-context`)
- `SOBATNGUPI_OUTBOX_DIR`
- `OUTBOX_SCAN_INTERVAL_MS`

## Queue lokal untuk semi-otomatis
Backend ini juga punya mode queue lokal untuk fase semi-otomatis.

Struktur folder queue:
- `queue/orders/draft`
- `queue/orders/final`
- `queue/orders/processed`
- `queue/orders/failed`

Struktur state aktif:
- `state/orders-active/<normalized-phone>.json`

Script yang tersedia:
- `npm run queue:sample` → membuat sample payload draft ke folder queue
- `npm run queue:run` → membaca payload dari queue draft/final lalu POST ke webhook
- `npm run queue:retry-failed` → retry semua file di bucket `failed/` lalu proses ulang

Env tambahan:
- `ORDER_WEBHOOK_URL` (default: `http://localhost:3001/webhooks/orders`)
- `AUTO_PROCESS_QUEUE` (`true` / `false`)
- `PAKASIR_BASE_URL` (default: `https://app.pakasir.com`)
- `PAKASIR_PROJECT_SLUG`
- `PAKASIR_API_KEY`
- `PUBLIC_BASE_URL` (untuk membentuk URL QR image, mis. `http://localhost:3001`)
- `WHATSAPP_SEND_QRIS_ON_CREATE` (`true` / `false`, default `true`) → coba kirim QR image ke customer saat payment QRIS dibuat
- `WHATSAPP_NOTIFY_QRIS_SUCCESS` (`true` / `false`, default `true`) → kirim notifikasi teks saat pembayaran QRIS terverifikasi
- `WACLI_BIN` (default `wacli`)

## Notes
- Kode sudah siap dihubungkan ke Supabase.
- Jika env Supabase belum diisi, endpoint tulis akan gagal dengan pesan yang jelas.
- Schema SQL ada di `supabase/schema.sql`.
- Perhitungan nominal QRIS saat ini memakai mapping harga menu inti di backend (`Es Kopi Susu Original`, `Americano`, `Caffe Latte`, `Cappuccino`). Jika ada biaya tambahan seperti ongkir, bisa sementara dikirim sebagai `amount` override saat membuat payment session.
- Saat payment QRIS dibuat, backend sekarang mencoba mengirim gambar QR langsung ke customer via `wacli send file`.
- Setelah QRIS terverifikasi, backend juga mencoba mengirim notifikasi WhatsApp langsung ke customer via `wacli`.
- Kedua pengiriman WhatsApp tersebut bersifat best-effort: create/verify payment tetap sukses walau pengiriman WA gagal, dan hasil kirim akan muncul di response sebagai `whatsapp_qris_delivery` atau `whatsapp_notification`.
