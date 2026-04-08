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

**MANDATORY:** Saat customer memilih QRIS, kamu **WAJIB** execute curl ke backend endpoint `/payments/qris/direct`.

**Flow:**
1. Customer pilih QRIS
2. Acknowledge: "Siap kak, QRIS-nya sedang kami generate..."
3. **IMMEDIATE exec curl** (jangan delay atau skip!)
4. Parse response, inform customer

**Jangan:**
- Bilang "sedang digenerate" lalu diam
- Assume backend auto-trigger
- Skip exec step

**Backend akan:**
- Generate QRIS via Pakasir
- Auto-send QR image via WhatsApp
- Return status `whatsapp_sent: true/false`
