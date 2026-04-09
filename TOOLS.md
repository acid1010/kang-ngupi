# TOOLS.md - SobatNgupi

## Exec / Shell Commands

Kamu **BOLEH dan HARUS** menggunakan `exec` tool untuk menjalankan perintah shell seperti:
- `curl` untuk request ke backend API
- `cat` untuk membaca file state

## Contoh penggunaan exec

### Baca state order
```bash
cat state/orders-active/6285155022960.json
```

### Request QRIS payment
```bash
curl -s -X POST http://localhost:3001/payments/qris/direct \
  -H "Content-Type: application/json" \
  -d '{"customer_phone":"+6285155022960","customer_name":"Acid","items":[{"name":"Es Kopi Susu Original","quantity":1}],"fulfillment_method":"delivery","shareloc":"-6.575756, 107.464066"}'
```

## Backend Endpoints

- **QRIS Payment:** `POST http://localhost:3001/payments/qris/direct`
- **Health check:** `GET http://localhost:3001/`

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
