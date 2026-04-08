# SobatNgupi Order Sync

Dokumen ini menjelaskan cara SobatNgupi menyimpan state order lokal dan menulis snapshot outbox untuk integrasi backend.

## Tujuan
- menjaga konteks order aktif per customer
- mengirim snapshot order ke backend tanpa HTTP langsung dari agent
- mendukung flow `outbox -> bridge -> queue -> webhook -> Supabase`

## State aktif
Lokasi:
- `state/orders-active/<normalized-customer-id>.json`

State aktif minimal menyimpan:
- `customerId`
- `customerPhone` bila tersedia
- `customerName`
- `channel`
- `rawMessage` (pesan order utama yang stabil)
- `rawMessageLatest`
- `items[]`
- `fulfillmentMethod`
- `locationStatus`
- `shareloc`
- `address`
- `confirmationStatus`
- `paymentMethod`
- `paymentStatus`
- `deliveryProvider`
- `notes[]`
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

Catatan khusus QRIS Pakasir:
- saat customer memilih QRIS, tulis `payment_selected` dengan `paymentMethod: "qris"` dan `paymentStatus: "pending"`
- jangan menulis `payment_confirmed` hanya karena customer bilang sudah transfer/bayar
- `payment_confirmed` untuk QRIS hanya boleh ditulis setelah backend memverifikasi transaksi secara otomatis
- untuk flow QRIS otomatis, default-nya tidak perlu minta bukti bayar manual ke customer

## Format snapshot
```json
{
  "customer_phone": "081234567890",
  "updates": {
    "customerName": "Acid",
    "rawMessage": "kopsu 2",
    "items": [
      {
        "menuId": "kopi-susu-original",
        "menuName": "Es Kopi Susu Original",
        "qty": 2,
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
    "notes": ["shareloc_received"]
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
