#!/usr/bin/env node
/**
 * Kang Ngupi Response Time Benchmark
 * 
 * Analyzes the most recent WA session for response times.
 * Run AFTER manually testing a flow via WhatsApp.
 * 
 * Usage:
 *   node benchmark.js                    # analyze most recent WA session
 *   node benchmark.js +6285155022960     # analyze specific phone
 *   node benchmark.js --all              # show all WA sessions
 *   node benchmark.js --history          # show benchmark history
 * 
 * Targets: greeting ≤3s, order ≤3s, confirm ≤2s, delivery ≤2s, ongkir ≤5s, qris ≤6s
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(process.env.HOME, '.openclaw/agents/main/sessions/sessions.json');
const SESSIONS_DIR = join(process.env.HOME, '.openclaw/agents/main/sessions');
const BENCH_FILE = join(__dirname, 'benchmarks.jsonl');

const args = process.argv.slice(2);

// --history mode
if (args.includes('--history')) {
  if (!existsSync(BENCH_FILE)) { console.log('No benchmarks yet.'); process.exit(0); }
  const lines = readFileSync(BENCH_FILE, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  console.log('\n📊 Benchmark History\n');
  console.log('Date'.padEnd(22) + 'Flow'.padEnd(10) + 'Total'.padStart(7) + '  Avg'.padStart(6) + '  Tools'.padStart(7) + '  Grade');
  console.log('─'.repeat(65));
  for (const b of lines) {
    const date = b.timestamp.slice(0, 19).replace('T', ' ');
    console.log(`${date}  ${(b.flow || '?').padEnd(8)} ${(b.totalTime + 's').padStart(6)}  ${(b.avgTime + 's').padStart(5)}  ${String(b.toolCalls).padStart(5)}  ${b.grade}`);
  }
  process.exit(0);
}

// Find session
function findSession(phone) {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  
  if (phone) {
    const key = `agent:main:whatsapp:direct:${phone}`;
    return sessions[key]?.sessionId;
  }
  
  // Find most recent WA session
  const waKeys = Object.keys(sessions).filter(k => k.includes('whatsapp'));
  if (waKeys.length === 0) return null;
  
  let newest = null;
  let newestTime = 0;
  for (const k of waKeys) {
    const sid = sessions[k].sessionId;
    const file = join(SESSIONS_DIR, `${sid}.jsonl`);
    if (!existsSync(file)) continue;
    const mtime = statSync(file).mtimeMs;
    if (mtime > newestTime) {
      newestTime = mtime;
      newest = { key: k, sessionId: sid };
    }
  }
  return newest?.sessionId;
}

// --all mode
if (args.includes('--all')) {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  const waKeys = Object.keys(sessions).filter(k => k.includes('whatsapp'));
  console.log(`\n📱 Active WA Sessions: ${waKeys.length}\n`);
  for (const k of waKeys) {
    const phone = k.split(':').pop();
    const sid = sessions[k].sessionId;
    const file = join(SESSIONS_DIR, `${sid}.jsonl`);
    const mtime = existsSync(file) ? new Date(statSync(file).mtimeMs).toISOString().slice(0, 19) : '?';
    console.log(`  ${phone} → ${sid.slice(0, 8)}... (${mtime})`);
  }
  process.exit(0);
}

// Analyze
const phone = args[0] || null;
const sessionId = findSession(phone);

if (!sessionId) {
  console.log('❌ No WA session found. Chat via WhatsApp first, then run this.');
  process.exit(1);
}

const file = join(SESSIONS_DIR, `${sessionId}.jsonl`);
const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));

// Extract timing
const results = [];
let toolCalls = 0;
let userTs = null;
let userMsg = '';

for (const d of lines) {
  if (d.type !== 'message') continue;
  const role = d.message?.role;
  const ts = d.timestamp;
  const content = d.message?.content;
  
  // Count tool calls
  if (role === 'assistant' && Array.isArray(content)) {
    const tools = content.filter(c => c.type === 'toolCall');
    toolCalls += tools.length;
  }
  
  if (role === 'user' && ts) {
    userTs = ts;
    // Try to extract the actual user message
    if (typeof content === 'string') {
      const lines2 = content.split('\n');
      userMsg = lines2[lines2.length - 1]?.trim().slice(0, 25) || '...';
      // Clean up metadata
      if (userMsg.startsWith('{') || userMsg.startsWith('```')) userMsg = '...';
    }
  }
  
  if (role === 'assistant' && userTs && ts) {
    let isTextReply = false;
    let replyText = '';
    let replyTools = [];
    
    if (typeof content === 'string' && content.trim() && content !== 'NO_REPLY') {
      isTextReply = true;
      replyText = content.slice(0, 70).replace(/\n/g, ' ');
    } else if (Array.isArray(content)) {
      const texts = content.filter(c => c.type === 'text' && c.text?.trim() && c.text !== 'NO_REPLY');
      const tools = content.filter(c => c.type === 'toolCall');
      replyTools = tools.map(t => t.name);
      
      if (texts.length > 0) {
        isTextReply = true;
        replyText = texts[0].text.slice(0, 70).replace(/\n/g, ' ');
      }
    }
    
    if (isTextReply) {
      const delta = (new Date(ts).getTime() - new Date(userTs).getTime()) / 1000;
      if (delta > 0.3 && delta < 120) {
        results.push({ userMsg, seconds: delta, reply: replyText, tools: replyTools });
      }
      userTs = null;
    }
  }
}

// Detect flow type
let flowType = 'unknown';
const replyTexts = results.map(r => r.reply.toLowerCase()).join(' ');
if (replyTexts.includes('qris') || replyTexts.includes('qr')) {
  flowType = replyTexts.includes('ongkir') || replyTexts.includes('km') ? 'full (delivery+qris)' : 'order (pickup+qris)';
} else if (replyTexts.includes('pickup') || replyTexts.includes('delivery')) {
  flowType = 'partial (to fulfillment)';
} else {
  flowType = results.length <= 2 ? 'greeting' : 'partial';
}

// Print
const phoneDisplay = Object.keys(JSON.parse(readFileSync(SESSIONS_FILE, 'utf8')))
  .find(k => k.includes(sessionId))?.split(':').pop() || '?';

console.log(`\n🧪 Kang Ngupi Response Time Benchmark`);
console.log(`📱 Phone: ${phoneDisplay}`);
console.log(`🔄 Flow: ${flowType} (${results.length} responses)\n`);

console.log('Step'.padEnd(28) + 'Time'.padStart(7) + '  Reply');
console.log('─'.repeat(95));

let totalTime = 0;
const targets = [3, 3, 2, 2, 5, 6, 5, 5]; // per-step targets

for (let i = 0; i < results.length; i++) {
  const r = results[i];
  const timeStr = `${r.seconds.toFixed(1)}s`;
  const target = targets[i] || 5;
  const indicator = r.seconds <= target * 0.7 ? '🟢' : r.seconds <= target ? '🟡' : r.seconds <= target * 1.5 ? '🟠' : '🔴';
  const label = r.userMsg.padEnd(25);
  console.log(`${indicator} ${label} ${timeStr.padStart(6)}  ${r.reply}`);
  totalTime += r.seconds;
}

console.log('─'.repeat(95));

const avg = totalTime / results.length;
let grade;
if (avg <= 3) grade = '🏆 EXCELLENT';
else if (avg <= 5) grade = '✅ GOOD';
else if (avg <= 8) grade = '⚠️  NEEDS WORK';
else grade = '🔴 SLOW';

console.log(`\n📈 Total: ${totalTime.toFixed(1)}s | Avg: ${avg.toFixed(1)}s | Tools: ${toolCalls} | Grade: ${grade}`);

// Save
const benchmark = {
  timestamp: new Date().toISOString(),
  phone: phoneDisplay,
  flow: flowType,
  totalTime: +totalTime.toFixed(1),
  avgTime: +avg.toFixed(1),
  toolCalls,
  grade: avg <= 3 ? 'excellent' : avg <= 5 ? 'good' : avg <= 8 ? 'needs_work' : 'slow',
  steps: results.map(r => ({ user: r.userMsg, seconds: +r.seconds.toFixed(1), reply: r.reply }))
};

const benchLine = JSON.stringify(benchmark) + '\n';
writeFileSync(BENCH_FILE, existsSync(BENCH_FILE) ? readFileSync(BENCH_FILE, 'utf8') + benchLine : benchLine);
console.log(`💾 Saved to benchmarks.jsonl\n`);
