#!/usr/bin/env node

/**
 * Calculate delivery fee (ongkir) from customer location to kedai
 * Usage: node calculate-ongkir.js <lat> <lng>
 * 
 * Returns JSON: { zone, distanceKm, fee, label }
 */

import 'dotenv/config';
import { calculateOngkir } from './src/delivery/ongkir.js';

const lat = parseFloat(process.argv[2]);
const lng = parseFloat(process.argv[3]);

if (isNaN(lat) || isNaN(lng)) {
  console.log(JSON.stringify({ ok: false, error: 'Usage: node calculate-ongkir.js <lat> <lng>' }));
  process.exit(1);
}

const result = calculateOngkir(lat, lng);
if (result.outOfRange) {
  console.log(JSON.stringify(result));
} else {
  console.log(JSON.stringify({ ok: true, ...result }));
}
