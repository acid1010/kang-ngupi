#!/usr/bin/env node
/**
 * Generate QR codes for dine-in tables
 * Each QR links to WhatsApp with pre-filled "Meja X" message
 * 
 * Usage: node generate-table-qr.js [num_tables]
 * Default: 10 tables
 * Output: backend/public/table-qr/meja-{N}.png
 */

import QRCode from 'qrcode';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'public', 'table-qr');
const WA_NUMBER = '6287786434813'; // Bot WhatsApp number (Kang Ngupi)

const numTables = parseInt(process.argv[2] || '10', 10);

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

console.log(`Generating QR codes for ${numTables} tables...\n`);

for (let i = 1; i <= numTables; i++) {
  const message = `Halo Kang Ngupi, saya mau dine in di meja ${i} nih. Liat menu nya dong!`;
  const waLink = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
  const filename = `meja-${i}.png`;
  const filepath = join(OUTPUT_DIR, filename);
  
  await QRCode.toFile(filepath, waLink, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 512,
    type: 'png',
    color: {
      dark: '#0d1b1b',
      light: '#ffffff'
    }
  });
  
  console.log(`  ✅ Meja ${i}: ${waLink}`);
  console.log(`     → ${filepath}`);
}

console.log(`\n🎉 Generated ${numTables} QR codes in ${OUTPUT_DIR}`);
console.log(`\nServed at: https://ngupingupi.me/table-qr/meja-{N}.png`);
