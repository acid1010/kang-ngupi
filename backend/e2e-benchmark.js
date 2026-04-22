#!/usr/bin/env node
/**
 * Kang Ngupi E2E Response Time Test
 * 
 * Sends real WhatsApp messages and measures actual response times
 * from OpenClaw session logs. No sugarcoating — real round-trip times.
 * 
 * Usage: node e2e-benchmark.js [--phone +62xxx] [--flow full|greeting|order]
 * 
 * Flows:
 *   greeting  — just "halo"
 *   order     — kopsu 1 → oke → pickup → qris
 *   full      — halo → kopsu 1 → oke → delivery → shareloc → qris
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync, execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(process.env.HOME, '.openclaw/agents/main/sessions/sessions.json');
const SESSIONS_DIR = join(process.env.HOME, '.openclaw/agents/main/sessions');
const WACLI = '/home/ubuntu/.local/bin/wacli';

// Parse args
const args = process.argv.slice(2);
const phoneIdx = args.indexOf('--phone');
const flowIdx = args.indexOf('--flow');
const PHONE = phoneIdx >= 0 ? args[phoneIdx + 1] : '+6285155022960';
const FLOW = flowIdx >= 0 ? args[flowIdx + 1] : 'full';
const JID = PHONE.replace('+', '') + '@s.whatsapp.net';
const SESSION_KEY = `agent:main:whatsapp:direct:${PHONE}`;

// Test shareloc coords (Purwakarta area, ~3km from kedai)
const TEST_LAT = -6.575624;
const TEST_LNG = 107.463;

const FLOWS = {
  greeting: [
    { msg: 'halo', wait: 8000, label: 'Greeting' },
  ],
  order: [
    { msg: 'kopsu 1', wait: 12000, label: 'Order kopsu' },
    { msg: 'oke', wait: 5000, label: 'Confirm' },
    { msg: 'pickup', wait: 5000, label: 'Pickup' },
    { msg: 'qris', wait: 15000, label: 'QRIS' },
  ],
  full: [
    { msg: 'halo', wait: 8000, label: 'Greeting' },
    { msg: 'kopsu 1', wait: 12000, label: 'Order kopsu' },
    { msg: 'oke', wait: 5000, label: 'Confirm' },
    { msg: 'delivery', wait: 5000, label: 'Delivery' },
    { msg: `loc:${TEST_LAT},${TEST_LNG}`, wait: 12000, label: 'Shareloc+Ongkir' },
    { msg: 'qris', wait: 15000, label: 'QRIS' },
  ],
};

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function clearSessions() {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  const waKeys = Object.keys(sessions).filter(k => k.includes('whatsapp') && k.includes(PHONE));
  for (const k of waKeys) delete sessions[k];
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  return waKeys.length;
}

function getSessionId() {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  return sessions[SESSION_KEY]?.sessionId;
}

function sendMessage(text) {
  try {
    if (text.startsWith('loc:')) {
      // Location message — send as text with coords (OpenClaw parses this)
      const [lat, lng] = text.replace('loc:', '').split(',');
      const locText = `https://maps.google.com/?q=${lat},${lng}`;
      execFileSync(WACLI, ['send', 'text', '--to', JID, '--text', locText], { timeout: 15000 });
    } else {
      execFileSync(WACLI, ['send', 'text', '--to', JID, '--text', text], { timeout: 15000 });
    }
    return true;
  } catch (e) {
    console.error(`  ❌ Failed to send: ${e.message}`);
    return false;
  }
}

function analyzeSession(sessionId) {
  const file = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return { results: [], toolCalls: 0 };
  
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  
  const results = [];
  let toolCalls = 0;
  let userTs = null;
  
  for (const d of lines) {
    if (d.type !== 'message') continue;
    const role = d.message?.role;
    const ts = d.timestamp;
    const content = d.message?.content;
    
    // Count tool calls
    if (role === 'assistant' && Array.isArray(content)) {
      toolCalls += content.filter(c => c.type === 'toolCall').length;
    }
    
    if (role === 'user' && ts) {
      userTs = ts;
    }
    
    if (role === 'assistant' && userTs && ts) {
      let isTextReply = false;
      let replyText = '';
      
      if (typeof content === 'string' && content.trim() && content !== 'NO_REPLY') {
        isTextReply = true;
        replyText = content.slice(0, 70).replace(/\n/g, ' ');
      } else if (Array.isArray(content)) {
        const texts = content.filter(c => c.type === 'text' && c.text?.trim());
        if (texts.length > 0 && texts[0].text !== 'NO_REPLY') {
          isTextReply = true;
          replyText = texts[0].text.slice(0, 70).replace(/\n/g, ' ');
        }
      }
      
      if (isTextReply) {
        const delta = (new Date(ts).getTime() - new Date(userTs).getTime()) / 1000;
        if (delta > 0.3 && delta < 120) {
          results.push({ seconds: delta, reply: replyText });
        }
        userTs = null;
      }
    }
  }
  
  return { results, toolCalls };
}

// ─── Main ───────────────────────────────────────────────────────────────

async function main() {
  const flow = FLOWS[FLOW];
  if (!flow) {
    console.error(`Unknown flow: ${FLOW}. Use: greeting, order, full`);
    process.exit(1);
  }
  
  console.log(`\n🧪 Kang Ngupi E2E Benchmark`);
  console.log(`📱 Phone: ${PHONE}`);
  console.log(`🔄 Flow: ${FLOW} (${flow.length} steps)\n`);
  
  // Step 1: Clear sessions
  const cleared = clearSessions();
  console.log(`🗑️  Cleared ${cleared} session(s)`);
  
  // Also delete active order state
  const stateFile = join(__dirname, '..', 'state', 'orders-active', `${PHONE}.json`);
  if (existsSync(stateFile)) {
    execSync(`rm ${stateFile}`);
    console.log(`🗑️  Cleared active order state`);
  }
  
  console.log(`\n📤 Sending messages...\n`);
  
  // Step 2: Send messages with waits
  for (let i = 0; i < flow.length; i++) {
    const step = flow[i];
    const displayMsg = step.msg.startsWith('loc:') ? '[shareloc]' : step.msg;
    process.stdout.write(`  ${i + 1}/${flow.length} Sending "${displayMsg}"...`);
    
    if (!sendMessage(step.msg)) {
      console.log(' FAILED');
      process.exit(1);
    }
    
    console.log(` waiting ${step.wait / 1000}s`);
    await sleep(step.wait);
  }
  
  // Step 3: Analyze
  console.log(`\n📊 Analyzing session logs...\n`);
  
  const sessionId = getSessionId();
  if (!sessionId) {
    console.log('❌ No session created. OpenClaw might not be running.');
    process.exit(1);
  }
  
  const { results, toolCalls } = analyzeSession(sessionId);
  
  if (results.length === 0) {
    console.log('❌ No responses found. Check OpenClaw logs.');
    process.exit(1);
  }
  
  // Step 4: Print results
  console.log('Step'.padEnd(22) + 'Time'.padStart(7) + '  Status  Reply');
  console.log('─'.repeat(90));
  
  let totalTime = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = flow[i]?.label || `Step ${i + 1}`;
    const timeStr = `${r.seconds.toFixed(1)}s`;
    const indicator = r.seconds <= 2 ? '🟢' : r.seconds <= 5 ? '🟡' : r.seconds <= 8 ? '🟠' : '🔴';
    console.log(`${indicator} ${label.padEnd(20)} ${timeStr.padStart(6)}  ${r.reply}`);
    totalTime += r.seconds;
  }
  
  console.log('─'.repeat(90));
  
  const validResults = results.length;
  const avg = totalTime / validResults;
  
  console.log(`\n📈 Summary:`);
  console.log(`   Total time:  ${totalTime.toFixed(1)}s`);
  console.log(`   Average:     ${avg.toFixed(1)}s/response`);
  console.log(`   Tool calls:  ${toolCalls}`);
  console.log(`   Steps:       ${validResults}`);
  
  // Grade
  let grade;
  if (avg <= 3) grade = '🏆 EXCELLENT (≤3s avg)';
  else if (avg <= 5) grade = '✅ GOOD (≤5s avg)';
  else if (avg <= 8) grade = '⚠️  NEEDS WORK (≤8s avg)';
  else grade = '🔴 SLOW (>8s avg)';
  console.log(`   Grade:       ${grade}`);
  
  // Targets
  console.log(`\n🎯 Targets:`);
  const targets = { 'Greeting': 3, 'Order kopsu': 3, 'Confirm': 2, 'Delivery': 2, 'Pickup': 2, 'Shareloc+Ongkir': 5, 'QRIS': 6 };
  for (let i = 0; i < results.length && i < flow.length; i++) {
    const label = flow[i].label;
    const target = targets[label] || 5;
    const actual = results[i].seconds;
    const pass = actual <= target;
    console.log(`   ${pass ? '✅' : '❌'} ${label.padEnd(18)} ${actual.toFixed(1)}s / ${target}s target`);
  }
  
  // Save
  const benchmark = {
    timestamp: new Date().toISOString(),
    phone: PHONE,
    flow: FLOW,
    totalTime: +totalTime.toFixed(1),
    avgTime: +avg.toFixed(1),
    toolCalls,
    grade: avg <= 3 ? 'excellent' : avg <= 5 ? 'good' : avg <= 8 ? 'needs_work' : 'slow',
    steps: results.map((r, i) => ({
      label: flow[i]?.label || `Step ${i + 1}`,
      seconds: +r.seconds.toFixed(1),
      reply: r.reply
    }))
  };
  
  const benchFile = join(__dirname, 'benchmarks.jsonl');
  const line = JSON.stringify(benchmark) + '\n';
  writeFileSync(benchFile, existsSync(benchFile) ? readFileSync(benchFile, 'utf8') + line : line);
  console.log(`\n💾 Saved to benchmarks.jsonl`);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
