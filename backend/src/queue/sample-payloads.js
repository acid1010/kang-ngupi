import 'dotenv/config';
import { buildDraftOrderPayload } from '../builders/orderPayload.js';
import { buildQueueFileName, ensureQueueDirs, writeQueueFile } from './fs.js';

await ensureQueueDirs();

const draftPayload = buildDraftOrderPayload({
  customerName: 'Acid',
  customerPhone: '081234567890',
  rawMessage: 'kopsu 2',
  items: [
    {
      menuId: 'kopi-susu-original',
      menuName: 'Es Kopi Susu Original',
      qty: 2,
      temperature: 'iced'
    }
  ],
  fulfillmentMethod: 'delivery',
  locationStatus: 'shareloc_received',
  shareloc: {
    lat: -6.5397,
    lng: 107.446,
    label: 'Purwakarta'
  },
  deliveryProvider: 'ngupi_express',
  paymentMethod: 'cod',
  paymentStatus: 'pending',
  notes: ['queued_locally']
});

const filePath = await writeQueueFile(
  'draft',
  buildQueueFileName('draft', draftPayload.order.client_order_id),
  draftPayload
);
console.log(`Sample draft payload written to ${filePath}`);
