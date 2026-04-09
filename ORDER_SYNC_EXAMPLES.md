# SobatNgupi Order Sync Examples

## Contoh state aktif customer

Path:
`state/orders-active/+6281234567890.json`

```json
{
  "orderId": "ORD-20260403-B7C1",
  "customerId": "+6281234567890",
  "customerPhone": "+6281234567890",
  "customerName": "Acid",
  "channel": "whatsapp",
  "rawMessage": "kopsu 2",
  "rawMessageLatest": "kopsu 2 delivery",
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

## Contoh snapshot outbox

Path:
`outbox/order-context/+6281234567890_2026-04-03T13-31-10-000Z_location_captured.json`

```json
{
  "customer_phone": "+6281234567890",
  "order_id": "ORD-20260403-B7C1",
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
    "paymentMethod": null,
    "paymentStatus": null,
    "deliveryProvider": null,
    "notes": [],
    "customerNotes": []
  }
}
```

## Checklist milestone
- `items_captured`: item + qty sudah cukup jelas (orderId dibuat di sini)
- `fulfillment_selected`: pickup atau delivery sudah jelas
- `location_captured`: shareloc atau alamat fallback sudah diterima
- `name_captured`: nama penerima sudah diketahui
- `order_confirmed`: customer sudah menyetujui konfirmasi order
- `payment_selected`: customer memilih COD / QRIS
- `payment_confirmed`: pembayaran QRIS sudah tervalidasi oleh backend
- `delivery_provider_selected`: customer memilih Ngupi Express / Grab / Gojek
- `order_cancelled`: customer membatalkan order (sebelum payment_confirmed)
- `order_completed`: pesanan selesai diproses / diterima customer

## Aturan praktis
- Jangan bikin state/outbox untuk chat yang cuma tanya harga.
- Jangan bikin diff kecil; selalu simpan snapshot penuh terbaru.
- Simpan `rawMessage` sebagai pesan order utama yang stabil, bukan pesan customer terakhir mentah.
- Untuk daftar balasan WhatsApp, pakai tanda minus `-`, jangan bullet khusus.
- Jika identifier customer belum jelas, tunda sinkronisasi dan fokus balas customer dulu.
