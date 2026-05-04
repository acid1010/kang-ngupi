#!/usr/bin/env node
/**
 * Test Doku QRIS integration
 * Usage: node test-doku.js [action]
 * Actions: token, generate, query, config
 */

import 'dotenv/config';
import { getAccessToken, generateQris, queryQris, getDokuConfig } from './src/payments/doku.js';

const action = process.argv[2] || 'token';

async function main() {
  console.log('🔧 Doku Config:', getDokuConfig());
  console.log('');

  switch (action) {
    case 'config':
      break;

    case 'token':
      console.log('📡 Getting B2B access token...');
      try {
        const token = await getAccessToken();
        console.log('✅ Token obtained:', token.slice(0, 30) + '...');
      } catch (e) {
        console.error('❌ Token error:', e.message);
      }
      break;

    case 'generate':
      console.log('📡 Generating test QRIS...');
      try {
        const result = await generateQris({
          orderId: `TEST-${Date.now()}`,
          amount: 10000,
          validityMinutes: 5
        });
        console.log('Result:', JSON.stringify(result, null, 2));
      } catch (e) {
        console.error('❌ Generate error:', e.message);
      }
      break;

    case 'query': {
      const refNo = process.argv[3];
      const partnerRef = process.argv[4];
      if (!refNo) {
        console.error('Usage: node test-doku.js query <originalReferenceNo> [partnerReferenceNo]');
        process.exit(1);
      }
      console.log('📡 Querying QRIS status...');
      try {
        const result = await queryQris({ originalReferenceNo: refNo, partnerReferenceNo: partnerRef });
        console.log('Result:', JSON.stringify(result, null, 2));
      } catch (e) {
        console.error('❌ Query error:', e.message);
      }
      break;
    }

    default:
      console.log('Usage: node test-doku.js [config|token|generate|query]');
  }
}

main().catch(console.error);
