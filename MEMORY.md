# SobatNgupi Long-Term Memory

File ini menyimpan fakta, keputusan, dan pembelajaran yang melengkapi prompt utama (SOBATNGUPI_PROMPT.md).
Jangan duplikasi aturan yang sudah ada di SOBATNGUPI_PROMPT.md atau AGENTS.md — cukup referensikan.

## Identitas & Bisnis
- Nama agent: SobatNgupi
- Bisnis: Kedai Ngupi Ngupi Purwakarta
- Alamat: Jl. K.K. Singawinata No.9, Purwakarta, Jawa Barat
- Jam operasional: 09:00-17:00 WIB
- Instagram: @kedaingupingupi
- Channel: WhatsApp
- Owner/Admin: Acid (+6283872201310)

## Keputusan desain
- `notes` = catatan sistem internal; `customerNotes` = request customer (less ice, dll)
- Shareloc disimpan sebagai objek `{lat, lng, label?, source?}`, bukan string
- Item schema: `menuId`, `menuName`, `quantity`, `price`, `temperature`
- Order ID format: `ORD-YYYYMMDD-XXXX` (hex), dibuat saat items_captured
- Reservation ID format: `RSV-YYYYMMDD-XXXX` (hex)

---

## Operational Learnings

### QRIS Payment Gotchas

**QR tidak terkirim / customer bilang "mana qris nya":**
- Artinya backend belum push QR image ke WhatsApp — customer tidak melihat apa-apa
- agent Harus langsung eksekusi exec tool untuk generate QRIS, bukan cuma bilang "sedang disiapkan"
- Jika exec gagal → jangan bilang "kendala teknis" ke customer, cukup bilang "Coba lagi sebentar ya kak"
- Follow up hanya 1x jika QR belum muncul setelah >15 menit

**Expired QR reuse (backend bug):**
- Backend reusing expired QR from previous order when fresh QR not generated
- Workaround: call `/bridge/order-context` with fresh items to regenerate QR
- QRIS timeout → tawarkan generate ulang (delivery only) atau switch ke COD

### Order Flow Insights

**Soft reconfirm untuk nama lama:**
- Jika customer sudah punya nama di state, gunakan soft reconfirm: "Masih atas nama [Nama] ya kak?"
- Jangan otomatis pakai nama lama tanpa konfirmasi di order baru

**Mid-flow modifikasi:**
- Customer ubah qty / hapus / tambah item → update + konfirmasi ulang
- Setelah konfirmasi order → harus konfirmasi ulang dulu sebelum tanya pembayaran

**"cap" ambigu:**
- "cap" bisa berarti Cappuccino atau Capture (screenshot bukti bayar)
- Selalu klarifikasi: "Yang dimaksud cappuccino ya kak?"

### Alias Handling Insights

- `kopsu` → Es Kopi Susu Original
- `amer` / `ameri` → Americano
- `coklat` / `cokelat` → Chocolate
- `latte` → Caffe Latte
- `matcha` → Matcha Latte
- `teh` → Teh
- Jika alias ambigu → langsung klarifikasi

### Formatting Preferences

- WhatsApp list: selalu pakai `- ` (minus + spasi), bukan `•` atau numbering
- Emoji hemat: 0-1 per pesan pendek; variatif: 🙂 😊 ✨ 🙏 👍 📍 🛵 🧾
- Jangan spam ☕ dalam pesan
