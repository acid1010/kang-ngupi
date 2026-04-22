#!/usr/bin/env node
/**
 * Kang Ngupi Response Time Benchmark
 * 
 * Simulates a full order flow via WhatsApp and measures response times.
 * Uses the OpenClaw gateway API to send messages and read responses.
 * 
 * Usage: node benchmark-response.js [phone]
 * Default phone: +6285155022960 (Acid test)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_FILE = join(process.env.HOME, '.openclaw/agents/main/sessions/sessions.json');
const SESSIONS_DIR = join(process.env.HOME, '.openclaw/agents/main/sessions');

const phone = process.argv[2] || '+6285155022960';
const sessionKey = `agent:main:whatsapp:direct:${phone}`;

function getSessionId() {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  return sessions[sessionKey]?.sessionId;
}

function clearSession() {
  const sessions = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
  const waKeys = Object.keys(sessions).filter(k => k.includes('whatsapp') && k.includes(phone));
  for (const k of waKeys) delete sessions[k];
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  return waKeys.length;
}

function analyzeSession(sessionId) {
  const file = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return null;
  
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  
  const results = [];
  let userTs = null;
  let userMsg = '';
  
  for (const d of lines) {
    if (d.type !== 'message') continue;
    const role = d.message?.role;
    const ts = d.timestamp;
    const content = d.message?.content;
    
    if (role === 'user' && ts) {
      userTs = ts;
      // Extract user message text
      if (typeof content === 'string') {
        const match = content.match(/\n\n(.+?)$/s);
        userMsg = match ? match[1].trim().slice(0, 30) : '...';
      }
    }
    
    if (role === 'assistant' && userTs && ts) {
      let isTextReply = false;
      let replyText = '';
      let toolCalls = [];
      
      if (typeof content === 'string' && content.trim()) {
        isTextReply = true;
        replyText = content.slice(0, 60).replace(/\n/g, ' ');
      } else if (Array.isArray(content)) {
        const texts = content.filter(c => c.type === 'text' && c.text?.trim());
        const tools = content.filter(c => c.type === 'toolCall');
        toolCalls = tools.map(t => t.name);
        
        if (texts.length > 0) {
          isTextReply = true;
          replyText = texts[0].text.slice(0, 60).replace(/\n/g, ' ');
        }
      }
      
      if (isTextReply) {
        const t1 = new Date(userTs).getTime();
        const t2 = new Date(ts).getTime();
        const delta = (t2 - t1) / 1000;
        
        if (delta > 0.5 && delta < 120) {
          results.push({
            userMsg,
            replyText,
            seconds: delta,
            toolCalls
          });
        }
        userTs = null;
      }
    }
  }
  
  return results;
}

function countToolCalls(sessionId) {
  const file = join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!existsSync(file)) return 0;
  
  const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  let count = 0;
  
  for (const d of lines) {
    if (d.type !== 'message') continue;
    const content = d.message?.content;
    if (Array.isArray(content)) {
      count += content.filter(c => c.type === 'toolCall').length;
    }
  }
  
  return count;
}

// Main
console.log('🔍 Kang Ngupi Response Time Benchmark');
console.log(`📱 Phone: ${phone}\n`);

const sessionId = getSessionId();
if (!sessionId) {
  console.log('❌ No active session found. Send a message first, then run this script.');
  process.exit(1);
}

const results = analyzeSession(sessionId);
if (!results || results.length === 0) {
  console.log('❌ No messages found in session.');
  process.exit(1);
}

// Print results
console.log('Step'.padEnd(35) + 'Time'.padStart(8) + '  Reply');
console.log('─'.repeat(90));

let totalTime = 0;
for (const r of results) {
  if (r.replyText === 'NO_REPLY') continue;
  const timeStr = `${r.seconds.toFixed(1)}s`;
  const indicator = r.seconds <= 2 ? '🟢' : r.seconds <= 5 ? '🟡' : '🔴';
  console.log(`${indicator} ${r.userMsg.padEnd(32)} ${timeStr.padStart(6)}  ${r.replyText}`);
  totalTime += r.seconds;
}

console.log('─'.repeat(90));
console.log(`Total: ${totalTime.toFixed(1)}s | Tool calls: ${countToolCalls(sessionId)} | Messages: ${results.length}`);

// Grading
const avg = totalTime / results.filter(r => r.replyText !== 'NO_REPLY').length;
console.log(`\nAverage: ${avg.toFixed(1)}s per response`);
if (avg <= 3) console.log('🏆 EXCELLENT — under 3s average');
else if (avg <= 5) console.log('✅ GOOD — under 5s average');
else if (avg <= 8) console.log('⚠️ OK — could be faster');
else console.log('🔴 SLOW — needs optimization');

// Save benchmark
const benchmark = {
  timestamp: new Date().toISOString(),
  phone,
  sessionId,
  totalTime: +totalTime.toFixed(1),
  avgTime: +avg.toFixed(1),
  toolCalls: countToolCalls(sessionId),
  steps: results.filter(r => r.replyText !== 'NO_REPLY').map(r => ({
    user: r.userMsg,
    seconds: +r.seconds.toFixed(1),
    reply: r.replyText
  }))
};

const benchFile = join(__dirname, 'benchmarks.jsonl');
const line = JSON.stringify(benchmark) + '\n';
writeFileSync(benchFile, existsSync(benchFile) ? readFileSync(benchFile, 'utf8') + line : line);
console.log(`\n📊 Saved to benchmarks.jsonl`);
