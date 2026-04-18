# PROPOSAL BISNIS

## KANG NGUPI: SISTEM PEMESANAN DIGITAL BERBASIS WHATSAPP UNTUK KEDAI KOPI

**Acid**
acid.digital@gmail.com

---

## I. Latar Belakang

Industri kedai kopi di Indonesia terus berkembang pesat. Menurut data ICO (International Coffee Organization), Indonesia merupakan produsen kopi terbesar keempat di dunia, dan konsumsi kopi domestik terus meningkat setiap tahunnya. Di tengah pertumbuhan ini, kedai kopi lokal menghadapi tantangan dalam hal efisiensi operasional dan jangkauan pelanggan.

Kedai Ngupi Ngupi Purwakarta adalah salah satu kedai kopi lokal yang telah membangun basis pelanggan setia. Namun, proses pemesanan masih dilakukan secara manual — pelanggan harus datang langsung atau menghubungi via WhatsApp tanpa sistem yang terstruktur. Hal ini menyebabkan:

- Potensi kesalahan pencatatan pesanan
- Waktu respon yang tidak konsisten
- Tidak ada sistem pembayaran digital terintegrasi
- Ketergantungan pada platform delivery pihak ketiga (GoFood, GrabFood) yang memotong komisi 20-35%
- Data pelanggan tidak tersimpan secara terstruktur

**Kang Ngupi** hadir sebagai solusi — sistem pemesanan digital berbasis WhatsApp yang dirancang khusus untuk kebutuhan Kedai Ngupi Ngupi Purwakarta.

---

## II. Deskripsi Produk

### a. Tujuan (Noble Purpose)

Kang Ngupi dikembangkan dengan tujuan memberdayakan kedai kopi lokal agar mampu bersaing di era digital tanpa harus bergantung pada platform pihak ketiga yang mengambil margin keuntungan besar.

Melalui sistem ini, kami memiliki visi untuk:

- **Meningkatkan efisiensi operasional** — otomasi pemesanan, pembayaran, dan pencatatan mengurangi beban kerja manual
- **Memperluas jangkauan pelanggan** — pelanggan bisa order dari mana saja via WhatsApp tanpa perlu install aplikasi baru
- **Mempertahankan margin keuntungan** — tanpa komisi per transaksi seperti platform delivery konvensional
- **Membangun database pelanggan** — data nomor HP, riwayat pesanan, dan preferensi menjadi aset bisnis kedai

### b. Konsumen Potensial

**1. Karakteristik calon konsumen:**

- Pelanggan setia Kedai Ngupi Ngupi yang sudah terbiasa order via WhatsApp
- Pelanggan baru yang mencari kemudahan pemesanan online
- Pekerja kantoran di area Purwakarta yang ingin pre-order sebelum mampir
- Pelanggan yang lebih memilih pembayaran cashless (QRIS)

**2. Permasalahan konsumen:**

- Harus menunggu balasan manual saat order via WhatsApp
- Tidak ada konfirmasi harga otomatis — harus tanya satu per satu
- Pembayaran hanya tunai — tidak ada opsi QRIS
- Tidak ada notifikasi status pesanan (sudah diproses atau belum)
- Tidak ada struk/bukti transaksi digital

**3. Potensi pasar:**

- WhatsApp digunakan oleh 90%+ pengguna smartphone di Indonesia
- Tren cashless payment terus meningkat — QRIS tumbuh 213% YoY (Bank Indonesia, 2024)
- Pelanggan semakin mengharapkan pengalaman digital yang seamless

### c. Produk

**Kang Ngupi** adalah sistem terintegrasi yang terdiri dari:

**1. Asisten Digital WhatsApp (Kang Ngupi Bot)**
- Menerima dan memproses pesanan otomatis 24/7
- Mengenali alias menu (contoh: "kopsu" → Es Kopi Susu Original)
- Konfirmasi pesanan lengkap dengan harga
- Mengirim foto menu jika diminta
- Handle komplain dan reservasi
- Bahasa santai dan natural — bukan robot

**2. Sistem Pembayaran QRIS Otomatis**
- QR code digenerate dan dikirim otomatis ke WhatsApp pelanggan
- Verifikasi pembayaran real-time
- Reminder otomatis jika belum bayar dalam 30 menit
- Auto-cancel jika tidak bayar dalam 1 jam
- Struk digital otomatis setelah pembayaran terverifikasi

**3. Dashboard Manajemen Pesanan**
- Akses via browser (HP/laptop)
- Monitor pesanan real-time
- Update status pesanan (proses → siap → selesai)
- Notifikasi otomatis ke pelanggan setiap perubahan status
- Statistik penjualan harian

**4. Integrasi Pawoon POS**
- Sinkronisasi menu otomatis (107 item + 76 foto)
- Setiap transaksi otomatis masuk ke Pawoon POS
- Tidak perlu input manual — mengurangi human error

**Keunikan dan diferensiasi:**

| Aspek | Platform Delivery (GoFood/Grab) | Kang Ngupi |
|-------|--------------------------------|------------|
| Komisi per order | 20-35% | 0% |
| Markup harga menu | Ya (20-30%) | Tidak — harga sama |
| Data pelanggan | Milik platform | Milik kedai |
| Integrasi POS | Tidak | Pawoon otomatis |
| Branding | Logo platform dominan | 100% branding kedai |
| Install aplikasi | Ya (GoFood/Grab app) | Tidak — cukup WhatsApp |

### d. Sumber Daya

**1. Keahlian tim:**

- **Acid** — Full-stack developer & system architect. Bertanggung jawab atas pengembangan seluruh sistem Kang Ngupi, dari backend, integrasi API, hingga deployment dan maintenance.

**2. Sumber daya teknis:**

Fisik:
- Cloud server (VPS) untuk hosting backend dan dashboard
- Domain dan SSL certificate (ngupingupi.me)

Non-Fisik:
- Keahlian pengembangan sistem berbasis Node.js, Next.js, dan Supabase
- Integrasi API: Pawoon POS, Pakasir (QRIS), WhatsApp
- Pengetahuan dalam keamanan sistem (anti prompt injection, HTTPS, security headers)

**3. Teknologi yang digunakan:**

| Komponen | Teknologi |
|----------|-----------|
| Backend | Node.js, Express.js |
| Database | Supabase (PostgreSQL) |
| Dashboard | Next.js, React, Tailwind CSS |
| POS Integration | Pawoon Open API |
| Payment | Pakasir (QRIS) |
| Messaging | WhatsApp (wacli) |
| AI Agent | OpenClaw Platform |
| Hosting | Cloud VPS, Nginx, PM2 |
| Security | Helmet, HTTPS, rate limiting |

---

## III. Fitur Otomasi

| Fitur | Deskripsi | Status |
|-------|-----------|--------|
| Menu sync | Otomatis sync 107 item dari Pawoon setiap hari jam 06:00 | ✅ Aktif |
| QRIS auto-cancel | Belum bayar >1 jam → otomatis dibatalkan + notifikasi | ✅ Aktif |
| Payment reminder | Reminder otomatis setelah 30 menit belum bayar | ✅ Aktif |
| Status notification | Update otomatis ke pelanggan setiap perubahan status | ✅ Aktif |
| Struk digital | Struk otomatis setelah pembayaran terverifikasi | ✅ Aktif |
| Feedback request | Minta rating setelah pesanan selesai | ✅ Aktif |
| Draft cleanup | Order draft dibersihkan otomatis setiap tengah malam | ✅ Aktif |
| Health monitoring | Cek kesehatan sistem setiap jam | ✅ Aktif |

---

## IV. Alur Pemesanan

**Alur Pelanggan (WhatsApp):**

1. Pelanggan chat ke nomor WhatsApp kedai
2. Kang Ngupi menyapa dan menanyakan nama
3. Pelanggan menyebutkan pesanan (bisa pakai alias: "kopsu", "amer")
4. Kang Ngupi konfirmasi: item, harga, total, atas nama
5. Pelanggan pilih pickup atau delivery
6. Pelanggan pilih metode bayar (QRIS/COD)
7. Jika QRIS: QR code otomatis dikirim → bayar → struk digital
8. Pesanan masuk ke dashboard → diproses → notifikasi ke pelanggan

**Alur Operasional (Dashboard):**

1. Order masuk (notifikasi real-time)
2. Staff proses pesanan
3. Update status: siap diambil / sedang diantar
4. Pelanggan dapat notifikasi WhatsApp
5. Pesanan selesai → feedback request otomatis

---

## V. Keamanan Sistem

- Enkripsi end-to-end WhatsApp
- HTTPS dengan SSL certificate
- Security headers (Helmet: X-Frame-Options, HSTS, X-Content-Type)
- Anti prompt injection — sistem menolak upaya manipulasi dari pelanggan
- Rate limiting pada semua endpoint API
- Validasi input pada semua form dan webhook
- Webhook secret verification (Pakasir)
- Data pelanggan tersimpan aman di Supabase (PostgreSQL)

---

## VI. Investasi

| Komponen | Deskripsi | Biaya |
|----------|-----------|-------|
| Setup & Development | Konfigurasi sistem, integrasi Pawoon, setup QRIS, training staff | Rp _______ |
| Server & Hosting | Cloud server, domain, SSL, monitoring 24/7 | Rp _______/bulan |
| Maintenance | Update sistem, bug fix, support teknis | Rp _______/bulan |

**Yang sudah termasuk:**

- Asisten digital Kang Ngupi (WhatsApp bot)
- Dashboard manajemen pesanan (web-based)
- Sistem pembayaran QRIS otomatis (Pakasir)
- Integrasi Pawoon POS (menu sync + order push)
- 107 item menu ter-sync + 76 foto menu
- Notifikasi status pesanan otomatis via WhatsApp
- Struk digital otomatis
- Sistem feedback & rating pelanggan
- Auto-cancel + payment reminder
- Keamanan: anti prompt injection, HTTPS, security headers
- Support teknis & maintenance berkelanjutan

**Simulasi penghematan vs platform delivery:**

Asumsi: 30 order/bulan, rata-rata Rp 35.000/order

| Platform | Revenue | Komisi | Bersih |
|----------|---------|--------|--------|
| GoFood (25% komisi) | Rp 1.050.000 | -Rp 262.500 | Rp 787.500 |
| Kang Ngupi (0%) | Rp 1.050.000 | Rp 0 | Rp 1.050.000 |

**Penghematan: Rp 262.500/bulan — Rp 3.150.000/tahun** (dari 30 order/bulan saja)

---

## VII. Penutup

Kang Ngupi dirancang untuk membantu Kedai Ngupi Ngupi meningkatkan penjualan, efisiensi operasional, dan pengalaman pelanggan melalui kanal yang sudah familiar — WhatsApp.

Dengan integrasi langsung ke Pawoon POS, pembayaran QRIS otomatis, dan asisten cerdas yang bisa handle pesanan 24/7, Kang Ngupi adalah solusi digital yang tepat untuk kedai kopi modern.

Sistem sudah **siap produksi** dan telah melalui pengujian menyeluruh. Kami siap berdiskusi lebih lanjut dan melakukan demo langsung.

Semoga proposal ini dapat menjadi awal dari kolaborasi yang memberikan manfaat nyata bagi pertumbuhan Kedai Ngupi Ngupi Purwakarta.

---

**Acid — Digital Solutions**
📱 +62 838 7220 1310
📧 dani639@xone.web.id
🌐 ngupingupi.me
