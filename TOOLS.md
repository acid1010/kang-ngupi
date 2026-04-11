# TOOLS.md - SobatNgupi

## Exec / Shell Commands

Kamu **BOLEH dan HARUS** menggunakan `exec` tool untuk menjalankan perintah shell seperti:
- `curl` untuk request ke backend API
- `cat` untuk membaca file state

## Backend Endpoints

### Primary QRIS Method — `/bridge/order-context`
```bash
curl -s -X POST http://localhost:3001/bridge/order-context \
  -H "Content-Type: application/json" \
  -d '{"customer_phone":"+628xxx","updates":{"paymentMethod":"qris","paymentStatus":"pending"}}'
```
Backend auto-detects `paymentMethod: qris`, generates QRIS via Pakasir, and sends QR image + caption to WhatsApp customer.

### DEPRECATED — `/payments/qris/direct`
**Catatan:** Endpoint ini tidak lagi direkomendasikan. Gunakan `/bridge/order-context` di atas sebagai gantinya.
```bash
curl -s -X POST http://localhost:3001/payments/qris/direct \
  -H "Content-Type: application/json" \
  -d '{"customer_phone":"+6285155022960","customer_name":"Acid","items":[{"name":"Es Kopi Susu Original","quantity":1}],"fulfillment_method":"delivery","shareloc":"-6.575756, 107.464066"}'
```

### Cek Status Pembayaran
```
curl -s http://localhost:3001/bridge/order-context/<phone>
```
Returns: `paymentStatus` ("pending" | "confirmed"), `paid_at` (timestamp kalau lunas, null kalau belum), items, dll.

**WAJIB** dipanggil saat customer bilang "done" / "udah bayar" / "lunas" untuk verifikasi SEBELUM konfirmasi pembayaran.

### Health check
- `GET http://localhost:3001/health`

## Penting

**QRIS AUTO-TRIGGER:** Backend sekarang auto-generate QRIS saat kamu sync order dengan `paymentMethod: qris`.

**Kamu TIDAK perlu call `/payments/qris/direct` manual!**

Cukup sync order state via `/bridge/order-context`:
```bash
curl -s -X POST http://localhost:3001/bridge/order-context \
  -H "Content-Type: application/json" \
  -d '{"customer_phone":"+628xxx","updates":{"paymentMethod":"qris","paymentStatus":"pending"}}'
```

Backend akan:
1. Detect `paymentMethod: qris`
2. Auto-generate QRIS via Pakasir
3. Auto-send QR image ke WhatsApp customer

Setelah exec berhasil, agent tinggal konfirmasi ke customer bahwa QR sudah dikirim.

**PENTING:** Kamu HARUS benar-benar memanggil `exec` tool untuk menjalankan curl di atas. Jangan hanya menulis teks balasan tanpa exec.

## Known Issues

### QRIS Expired-Reuse Bug

**Gejala:**
- Backend mengembalikan `{"skipped": true, "reason": "already-exists"}` meskipun QRIS sudah expired
- Customer tidak menerima QR image baru di WhatsApp
- Customer bilang "mana QR-nya" atau QR tidak muncul

**Penyebab:**
Backend Pakasir melakukan skip jika sudah ada payment record untuk order/customer yang sama, tanpa memeriksa apakah QRIS sudah expired atau belum.

**Workaround sementara:**
Hapus state lama di backend (`/state/orders-active/<phone>.json`) agar order baru bisa dibuat fresh — ini memaksa backend generate QRIS baru.

**Fix yang dibutuhkan di backend:**
- Auto-detect expired QRIS (berdasarkan timestamp atau status)
- Regenerate QRIS otomatis tanpa perlu hapus state manual
