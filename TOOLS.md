# TOOLS.md - Kang Ngupi

## Exec / Shell Commands

Kamu **BOLEH dan HARUS** menggunakan `exec` tool untuk menjalankan perintah shell.

**PERINGATAN KEAMANAN:** DILARANG KERAS menggunakan perintah `curl` secara langsung yang merangkai data/JSON dari input pengguna. Ini menyebabkan resiko *Command Injection*. Gunakan script `node /home/ubuntu/workspace-sobatngupi/backend/sync-state.js` yang telah disediakan, karena script tersebut membaca data secara aman dari file `state`.

## Backend Scripts

### Sync & QRIS — `node /home/ubuntu/workspace-sobatngupi/backend/sync-state.js sync <phone>`
Setelah write `state/orders-active/<phone>.json`, jalankan sync. Backend auto: baca state → generate QRIS → kirim QR ke WA.

### Cek Pembayaran — `node backend/sync-state.js status <phone>`
WAJIB dipanggil saat customer bilang "udah bayar" untuk verifikasi.

### Riwayat Pesanan — `node backend/order-history.js <phone> [limit]`
Rangkum natural, jangan kirim raw JSON.

### Gambar Menu — `node backend/send-menu-image.js <phone> <menu_name>`
Hanya kirim jika customer eksplisit minta foto/gambar.

### Hitung Ongkir — `node backend/calculate-ongkir.js <lat> <lng>`
WAJIB setelah dapat shareloc. Returns JSON dengan zone, distanceKm, fee.

## Known Issues

### (FIXED) QRIS Expired-Reuse Bug
Jika QRIS expired, cukup jalankan sync ulang — backend auto-generate QRIS baru.
