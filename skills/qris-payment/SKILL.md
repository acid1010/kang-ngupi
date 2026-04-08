# QRIS Payment Skill

Skill untuk generate dan kirim QRIS payment ke customer.

## Kapan Digunakan

Gunakan skill ini saat customer memilih QRIS sebagai metode pembayaran.

## Cara Pakai

Jalankan script dengan parameter order:

```bash
./skills/qris-payment/create.sh "<phone>" "<name>" "<menu>" <quantity> "<fulfillment>" "<shareloc>"
```

**Contoh:**
```bash
./skills/qris-payment/create.sh "+6285155022960" "Dodo" "Es Kopi Susu Original" 1 "delivery" "-6.575756, 107.464066"
```

## Output

Script akan output response yang LANGSUNG kamu kirim ke customer (sudah include directive `MEDIA: <url>`).

**Contoh output:**
```
MEDIA: http://localhost:3001/payments/abc-123/qr.png
Siap kak Dodo, ini QRIS-nya. Total Rp17.000. Verifikasi otomatis ya kak 🙂
```

## Penting

- Output script sudah final, LANGSUNG kirim ke customer tanpa edit
- JANGAN tambah penjelasan teknis
- JANGAN sebut "backend", "curl", "script", dll
