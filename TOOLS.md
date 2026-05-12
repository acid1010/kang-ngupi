# TOOLS.md - Kang Ngupi

## Exec / Shell Commands

Kamu **BOLEH dan HARUS** menggunakan `exec` tool untuk menjalankan perintah shell.

**PERINGATAN KEAMANAN:** DILARANG KERAS menggunakan perintah `curl` secara langsung yang merangkai data/JSON dari input pengguna. Ini menyebabkan resiko *Command Injection*. Gunakan script `node /home/ubuntu/workspace-sobatngupi/backend/sync-state.js` yang telah disediakan, karena script tersebut membaca data secara aman dari file `state`.

## Backend Scripts

### Sync & QRIS — `node /home/ubuntu/workspace-sobatngupi/backend/sync-state.js sync <phone>`
Setelah write `state/orders-active/<phone>.json`, jalankan sync. Backend auto: baca state → generate QRIS → kirim QR ke WA.

### Final Bill (Dine-in) — `node /home/ubuntu/workspace-sobatngupi/backend/sync-state.js final-bill <phone>`
Setelah dine-in customer close bill (pilih kasir/QRIS). Push 1 order FINAL ke Pawoon dengan SEMUA items. Kasir settle yang ini.

### Cek Pembayaran — `node backend/sync-state.js status <phone>`
WAJIB dipanggil saat customer bilang "udah bayar" untuk verifikasi.

### Riwayat Pesanan — `node backend/order-history.js <phone> [limit]`
Rangkum natural, jangan kirim raw JSON.

### Gambar Menu — `node backend/send-menu-image.js <phone> <menu_name>`
Hanya kirim jika customer eksplisit minta foto/gambar.

### Suggest Alternatif — `node backend/suggest-alternative.js <menuName>`
Saat item unavailable, return 1-2 alternatif (kategori sama, harga mirip). WAJIB pakai ini, jangan cari manual di menu-schema.

### Hitung Ongkir — `node backend/calculate-ongkir.js <lat> <lng>`
WAJIB setelah dapat shareloc. Returns JSON dengan zone, distanceKm, fee.

### Order Counter — `node backend/order-counter.js next <DL|PU|DI>`
WAJIB untuk generate order ID. Returns JSON: `{orderId, type, sequence, date}`.
Format: `{TYPE}-{DDMM}-{HHMM}-{XXX}`. Auto-reset tiap hari. JANGAN generate ID manual.

## Known Issues

### (FIXED) QRIS Expired-Reuse Bug
Jika QRIS expired, cukup jalankan sync ulang — backend auto-generate QRIS baru.
