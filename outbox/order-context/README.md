# SobatNgupi Order Context Outbox

Folder ini dipakai sebagai outbox lokal dari workspace SobatNgupi menuju backend `ngupi-backend`.

## Tujuan
SobatNgupi dapat menulis file JSON event ke folder ini tanpa perlu memanggil HTTP langsung.

## Struktur
- `./` → file event baru
- `./processed/` → file yang sudah diproses backend
- `./failed/` → file yang gagal diproses

## Format file
Contoh isi file:

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
      "lng": 107.4460,
      "label": "Purwakarta",
      "source": "whatsapp"
    },
    "notes": ["shareloc_received"]
  }
}
```
