# TOOLS.md - SobatNgupi

## Exec / Shell Commands

Kamu **BOLEH dan HARUS** menggunakan `exec` tool untuk menjalankan perintah shell.

**PERINGATAN KEAMANAN:** DILARANG KERAS menggunakan perintah `curl` secara langsung yang merangkai data/JSON dari input pengguna. Ini menyebabkan resiko *Command Injection*. Gunakan script `node backend/sync-state.js` yang telah disediakan, karena script tersebut membaca data secara aman dari file `state`.

## Backend Scripts

### Primary QRIS Method & Sync — `node backend/sync-state.js sync`
Jalankan perintah ini setelah kamu mengupdate dan mensimpan file `state/orders-active/<phone>.json`:
```bash
node backend/sync-state.js sync <customer_phone>
```
Contoh:
```bash
node backend/sync-state.js sync +628123456789
```
Backend akan otomatis:
1. Membaca data state (nama, pesanan, shareloc) secara aman tanpa merangkai JSON mentah.
2. Jika `paymentMethod` = `qris` dan `paymentStatus` = `pending`, backend akan auto-generate QRIS via Pakasir.
3. Mengirim QR image + caption ke WhatsApp customer.

Setelah exec berhasil, konfirmasi ke customer bahwa QR sudah dikirim.

### Cek Status Pembayaran — `node backend/sync-state.js status`
Untuk mengecek apakah customer sudah bayar QRIS atau belum:
```bash
node backend/sync-state.js status <customer_phone>
```
Returns: `{"ok":true,"paymentStatus":"pending","paymentMethod":"qris",...}`

**WAJIB** dipanggil saat customer bilang "done" / "udah bayar" / "lunas" untuk verifikasi SEBELUM konfirmasi pembayaran.

## Penting

**QRIS AUTO-TRIGGER:** Backend otomatis melakukan trigger QRIS ketika state memuat `paymentMethod: qris`.

**Kamu TIDAK BOLEH menggunakan `/payments/qris/direct` dan `curl` secara manual!**

Cukup pastikan state file terbaru sudah tertulis, lalu jalankan sinkronisasi dengan aman:
```bash
node backend/sync-state.js sync <customer_phone>
```

**PENTING:** Kamu HARUS benar-benar memanggil `exec` tool untuk menjalankan perintah di atas. Jangan hanya menulis teks balasan tanpa exec.

### Riwayat Pesanan — `node backend/order-history.js`
Untuk melihat riwayat pesanan customer (misal customer tanya "pesanan terakhir apa?"):
```bash
node backend/order-history.js <customer_phone> [limit]
```
Contoh:
```bash
node backend/order-history.js +6285155022960 3
```
Returns JSON dengan daftar order terbaru beserta items, status pembayaran, dan total.

Gunakan data ini untuk menjawab pertanyaan customer tentang pesanan sebelumnya. **Jangan kirim raw JSON ke customer** — rangkum dalam bahasa natural.

Contoh jawaban:
- "Pesanan terakhir kak Acid: Es Kopi Susu Original x1 (Rp17.000), delivery, udah dibayar QRIS ✅"
- "3 pesanan terakhir kak: 1) Americano x1, 2) Kopsu x2, 3) Matcha Latte x1"

## Known Issues

### (FIXED) QRIS Expired-Reuse Bug
Bug ini sudah diperbaiki. Jika QRIS lama sudah kedaluwarsa (expired) dan customer meminta QRIS baru, cukup jalankan perintah sync kembali:
```bash
node backend/sync-state.js sync <customer_phone>
```
Backend secara otomatis akan mengevaluasi QRIS yang expired dan men-generate ulang QRIS baru tanpa perlu kamu menghapus file state lama secara manual.
