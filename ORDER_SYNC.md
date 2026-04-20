# Kang Ngupi Order Sync

Dokumen ini menjelaskan cara Kang Ngupi menyimpan state order lokal dan menulis snapshot outbox untuk integrasi backend.

## Tujuan
- menjaga konteks order aktif per customer
- mengirim snapshot order ke backend tanpa HTTP langsung dari agent
- mendukung flow `outbox -> bridge -> queue -> webhook -> Supabase`

## State aktif
Lokasi:
- `state/orders-active/<normalized-customer-id>.json`

State aktif minimal menyimpan:
- `orderId` — ID unik order per customer, format: `NGUPI-<XXX>` (e.g. `NGUPI-200426-001`, `NGUPI-200426-002`). Nomor sequential per customer, mulai dari 001. Cek `orderCount` di `state/customers/<phone>.json` untuk nomor berikutnya.
- `customerId`
- `customerPhone` bila tersedia
- `customerName`
- `channel`
- `rawMessage` (pesan order utama yang stabil)
- `rawMessageLatest`
- `items[]`
- `fulfillmentMethod`
- `locationStatus`
- `shareloc` (objek: `{lat, lng, label?, source?}` — lihat catatan format di bawah)
- `address`
- `confirmationStatus`
- `paymentMethod`
- `paymentStatus`
- `deliveryProvider`
- `notes[]` — catatan sistem/internal (e.g. `shareloc_received`, `qris_pending`)
- `customerNotes[]` — catatan/request dari customer (e.g. `less ice`, `gula dikit`)
- `lastMilestone`
- `createdAt`
- `updatedAt`
- `expiresAt`

## Expiry
- state dianggap stale jika tidak ada update lebih dari 24 jam
- state stale dipindah ke `state/orders-expired/`

## Outbox snapshot
Lokasi:
- `outbox/order-context/`

Nama file:
- `<normalized-customer-id>_<timestamp>_<milestone>.json`

Milestone utama:
- `items_captured`
- `fulfillment_selected`
- `location_captured`
- `name_captured`
- `order_confirmed`
- `payment_selected`
- `payment_confirmed`
- `delivery_provider_selected`
- `order_cancelled`
- `order_completed`

Catatan khusus QRIS Pakasir:
- saat customer memilih QRIS, tulis `payment_selected` dengan `paymentMethod: "qris"` dan `paymentStatus: "pending"`
- jangan menulis `payment_confirmed` hanya karena customer bilang sudah transfer/bayar
- `payment_confirmed` untuk QRIS hanya boleh ditulis setelah backend memverifikasi transaksi secara otomatis
- untuk flow QRIS otomatis, default-nya tidak perlu minta bukti bayar manual ke customer

## Format item order (berlaku untuk state DAN outbox)
Gunakan field yang sama di state aktif maupun snapshot outbox agar konsisten:
- `menuId` — ID menu dari menu-schema.json (e.g. `kopi-susu-original`)
- `menuName` — nama lengkap menu (e.g. `Es Kopi Susu Original`)
- `quantity` — jumlah item (angka, bukan string)
- `price` — harga satuan dari menu-schema.json
- `temperature` — `iced` / `hot` jika disebutkan customer (opsional)

**Jangan** gunakan `name` sebagai pengganti `menuName`, atau `qty` sebagai pengganti `quantity`. Selalu pakai field di atas.

## Format snapshot
```json
{
  "customer_phone": "081234567890",
  "order_id": "ORD-20260403-A1B2",
  "updates": {
    "customerName": "Acid",
    "rawMessage": "kopsu 2",
    "items": [
      {
        "menuId": "kopi-susu-original",
        "menuName": "Es Kopi Susu Original",
        "quantity": 2,
        "price": 17000,
        "temperature": "iced"
      }
    ],
    "fulfillmentMethod": "delivery",
    "locationStatus": "shareloc_received",
    "shareloc": {
      "lat": -6.5397,
      "lng": 107.446,
      "label": "Purwakarta",
      "source": "whatsapp"
    },
    "notes": ["shareloc_received"],
    "customerNotes": []
  }
}
```

## Aturan penting
- hanya tulis snapshot untuk flow order
- snapshot harus berupa salinan penuh terbaru yang relevan
- `rawMessage` di snapshot harus menyimpan pesan order utama yang stabil, bukan pesan customer terakhir secara mentah
- jika order utama sudah jelas dari pesan seperti `kopsu 2`, jangan ganti `rawMessage` menjadi pesan berikutnya seperti `delivery`, `COD`, atau `ngupi express`
- `rawMessageLatest` boleh terus berubah untuk konteks internal, tetapi `updates.rawMessage` ke backend harus tetap stabil
- jika identifier customer stabil belum tersedia, tunda sinkronisasi tetapi tetap bantu customer
- jika write gagal, balasan customer tetap prioritas
- jika payment method adalah QRIS, sinkronisasi awal tetap `pending` sampai backend mengirim/verifikasi status pembayaran
- saat backend sudah menyatakan QRIS terverifikasi, sinkronisasi `payment_confirmed` harus membawa `paymentMethod: "qris"` dan `paymentStatus: "confirmed"`
- jangan anggap chat customer seperti `sudah bayar` sebagai sumber kebenaran untuk QRIS otomatis

## Format shareloc
- Di state aktif dan outbox, `shareloc` harus disimpan sebagai objek:
  ```json
  {
    "lat": -6.5397,
    "lng": 107.446,
    "label": "Purwakarta",
    "source": "whatsapp"
  }
  ```
- Jika shareloc masuk sebagai string koordinat (e.g. `"-6.5397, 107.446"`), parse menjadi objek dengan `lat`/`lng` dan set `source: "whatsapp"`
- `label` boleh kosong jika tidak tersedia
- Jangan simpan shareloc sebagai string mentah di state maupun outbox

## Reservasi

### State reservasi
Lokasi: `state/reservations-active/<normalized-customer-id>.json`

State minimal:
- `reservationId` — format: `RSV-<YYYYMMDD>-<4 digit hex>` (e.g. `RSV-20260412-3D8A`)
- `customerId`
- `customerPhone`
- `customerName`
- `channel`
- `date` — tanggal reservasi (ISO date, e.g. `2026-04-12`)
- `time` — jam reservasi (e.g. `14:00`)
- `partySize` — jumlah orang
- `status` — `pending` / `confirmed` / `cancelled`
- `lastMilestone`
- `createdAt`
- `updatedAt`

### Outbox reservasi
Lokasi: `outbox/reservation-context/`

Nama file: `<normalized-customer-id>_<timestamp>_<milestone>.json`

Milestone reservasi:
- `reservation_confirmed`
- `reservation_cancelled`

Format snapshot:
```json
{
  "customer_phone": "+6281234567890",
  "reservation_id": "RSV-20260412-3D8A",
  "updates": {
    "customerName": "Acid",
    "date": "2026-04-12",
    "time": "14:00",
    "partySize": 4,
    "status": "confirmed"
  }
}
```

## Pembatalan order
- Jika customer membatalkan order, tulis milestone `order_cancelled` dengan `confirmationStatus: "cancelled"`
- Setelah snapshot ditulis, pindahkan state aktif ke `state/orders-expired/`
- Pembatalan hanya bisa diproses sebelum `payment_confirmed`; setelah itu perlu eskalasi refund

## Contoh state aktif

Path: `state/orders-active/+6281234567890.json`
```json
{
  "orderId": "ORD-20260403-B7C1",
  "customerId": "+6281234567890",
  "customerPhone": "+6281234567890",
  "customerName": "Acid",
  "channel": "whatsapp",
  "rawMessage": "kopsu 2",
  "rawMessageLatest": "kopsu 2 delivery",
  "items": [{"menuId": "kopi-susu-original", "menuName": "Es Kopi Susu Original", "quantity": 2, "price": 17000, "temperature": "iced"}],
  "fulfillmentMethod": "delivery",
  "locationStatus": "shareloc_received",
  "shareloc": {"lat": -6.5397, "lng": 107.446, "label": "Purwakarta", "source": "whatsapp"},
  "address": null,
  "confirmationStatus": "pending",
  "paymentMethod": null,
  "paymentStatus": null,
  "deliveryProvider": null,
  "notes": [],
  "customerNotes": [],
  "lastMilestone": "location_captured",
  "createdAt": "2026-04-03T13:30:00.000Z",
  "updatedAt": "2026-04-03T13:31:10.000Z",
  "expiresAt": "2026-04-04T13:31:10.000Z"
}
```
