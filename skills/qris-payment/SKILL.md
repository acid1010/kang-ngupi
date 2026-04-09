# QRIS Payment Skill

Skill untuk generate dan kirim QRIS payment ke customer.

## Kapan Digunakan

Gunakan skill ini saat customer memilih QRIS sebagai metode pembayaran.

## Cara Pakai

Jalankan script dengan parameter order. Items dikirim sebagai JSON array agar mendukung multi-item.

```bash
./skills/qris-payment/create.sh "<phone>" "<name>" '<items_json>' "<fulfillment>" "<shareloc>"
```

### Single item
```bash
./skills/qris-payment/create.sh "+6285155022960" "Dodo" '[{"name":"Es Kopi Susu Original","quantity":1}]' "delivery" "-6.575756, 107.464066"
```

### Multi-item
```bash
./skills/qris-payment/create.sh "+6285155022960" "Dodo" '[{"name":"Es Kopi Susu Original","quantity":2},{"name":"Americano","quantity":1}]' "delivery" "-6.575756, 107.464066"
```

## Output

Script akan output response yang LANGSUNG kamu kirim ke customer (sudah include directive `MEDIA: <url>`).

**Contoh output:**
```
MEDIA: http://localhost:3001/payments/abc-123/qr.png
Siap kak Dodo, ini QRIS-nya. Total Rp49.000. Verifikasi otomatis ya kak 🙂
```

## Dependencies

- `jq` (untuk build dan parse JSON secara aman)
- `curl`

## Penting

- Output script sudah final, LANGSUNG kirim ke customer tanpa edit
- JANGAN tambah penjelasan teknis
- JANGAN sebut "backend", "curl", "script", dll
- Error teknis ditulis ke stderr, bukan ke customer
