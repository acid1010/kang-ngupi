# SobatNgupi State

- `orders-active/` menyimpan state order aktif per customer.
- `orders-expired/` menyimpan state yang sudah stale dan dipindahkan untuk audit ringan.

State lokal ini dipakai SobatNgupi agar sinkronisasi order ke backend tetap konsisten selama percakapan WhatsApp berjalan.
