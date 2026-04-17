# Kang Ngupi Order Context Outbox

Folder ini dipakai sebagai outbox lokal dari workspace Kang Ngupi menuju backend `ngupi-backend`.

## Tujuan
Kang Ngupi dapat menulis file JSON event ke folder ini tanpa perlu memanggil HTTP langsung.

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
        "quantity": 2,
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
