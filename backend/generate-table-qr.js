#!/usr/bin/env node
/**
 * Generate QR codes for dine-in tables with WhatsApp logo in center
 * Each QR links to WhatsApp with pre-filled "Meja X" message
 * 
 * Usage: node generate-table-qr.js [num_tables]
 * Default: 20 customer tables + 1 cashier QR
 * Output: backend/public/table-qr/meja-{N}.png and kasir-1.png
 */

import QRCode from 'qrcode';
import sharp from 'sharp';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, 'public', 'table-qr');
const LOGO_PATH = join(__dirname, 'public', 'wa-logo.png');
const WA_NUMBER = '6287786434813'; // Bot WhatsApp number (Kang Ngupi)

const QR_SIZE = 512;
const LOGO_SIZE = Math.round(QR_SIZE * 0.15); // ~15% of QR size

const numTables = parseInt(process.argv[2] || '20', 10);

// Ensure output directory exists
if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Prepare logo overlay (resize + add white circle background)
async function prepareLogo() {
  const padding = 8;
  const totalSize = LOGO_SIZE + padding * 2;
  
  // Create circular white background
  const circle = Buffer.from(
    `<svg width="${totalSize}" height="${totalSize}">
      <circle cx="${totalSize/2}" cy="${totalSize/2}" r="${totalSize/2}" fill="white"/>
    </svg>`
  );
  
  // Resize logo
  const resizedLogo = await sharp(LOGO_PATH)
    .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer();
  
  // Composite: white circle + logo on top
  const logoWithBg = await sharp(circle)
    .composite([{
      input: resizedLogo,
      left: padding,
      top: padding
    }])
    .png()
    .toBuffer();
  
  return { buffer: logoWithBg, size: totalSize };
}

async function generateQRWithLogo(text, outputPath, logo) {
  // Generate QR as buffer (high error correction for logo overlay)
  const qrBuffer = await QRCode.toBuffer(text, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: QR_SIZE,
    type: 'png',
    color: {
      dark: '#0d1b1b',
      light: '#ffffff'
    }
  });
  
  // Overlay logo in center
  const left = Math.round((QR_SIZE - logo.size) / 2);
  const top = Math.round((QR_SIZE - logo.size) / 2);
  
  await sharp(qrBuffer)
    .composite([{
      input: logo.buffer,
      left,
      top
    }])
    .png()
    .toFile(outputPath);
}

console.log(`Generating QR codes for ${numTables} tables (with WA logo)...\n`);

const logo = await prepareLogo();

for (let i = 1; i <= numTables; i++) {
  const message = `Halo Kang Ngupi, saya di meja ${i} nih!`;
  const waLink = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(message)}`;
  const filepath = join(OUTPUT_DIR, `meja-${i}.png`);
  
  await generateQRWithLogo(waLink, filepath, logo);
  console.log(`  ✅ Meja ${i}: ${filepath}`);
}

// Cashier QR
const cashierMessage = 'Halo Kang Ngupi, saya di meja kasir 1 nih!';
const cashierLink = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(cashierMessage)}`;
const cashierPath = join(OUTPUT_DIR, 'kasir-1.png');
await generateQRWithLogo(cashierLink, cashierPath, logo);
console.log(`  ✅ Kasir 1: ${cashierPath}`);

console.log(`\n🎉 Generated ${numTables} table QR codes + 1 cashier QR with WA logo`);
console.log(`   Output: ${OUTPUT_DIR}`);
