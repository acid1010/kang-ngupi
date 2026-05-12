/**
 * Idle Chat Nudge — remind customers who left a conversation hanging
 * 
 * Logic:
 * 1. Check ALL WA sessions that are idle (last activity > 15 min)
 * 2. Only nudge if the LAST message was from the BOT (we're waiting on customer)
 * 3. Only nudge ONCE per session per day — no second nudge, no auto-cancel
 * 4. Only during business hours (09:00-21:00 WIB)
 * 5. Don't nudge if session is too old (> 4 hours)
 * 
 * Run via scheduler: every 15 min during business hours
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import logger from '../lib/logger.js';
import { runWacliSafe } from '../notifications/whatsapp.js';

const NUDGE_STATE_DIR = '/home/ubuntu/workspace-sobatngupi/state/nudge-tracking';
const NUDGE_AFTER_MS = 15 * 60 * 1000;  // 15 minutes idle
const MAX_AGE_MS = 4 * 60 * 60 * 1000;  // Don't nudge sessions older than 4 hours

function toJid(phone) {
  let p = String(phone).trim().replace(/[\s\-()]/g, '');
  if (p.startsWith('08')) p = '+62' + p.slice(1);
  if (p.startsWith('62') && !p.startsWith('+')) p = '+' + p;
  return p.startsWith('+') ? p.slice(1) + '@s.whatsapp.net' : null;
}

async function sendWa(phone, message) {
  const jid = toJid(phone);
  if (!jid) return false;
  try {
    await runWacliSafe(['send', 'text', '--to', jid, '--message', message]);
    return true;
  } catch (err) {
    logger.warn('[nudge] Failed to send to %s: %s', phone, err.message);
    return false;
  }
}

function getNudgeMessage(customerName) {
  const name = customerName ? ` kak ${customerName}` : ' kak';
  // Randomize slightly to feel natural
  const templates = [
    `Hai${name}, masih mau lanjut atau ada yang bisa dibantu? 😊`,
    `Hai${name}, masih mau pesan atau ada yang bisa aku bantu? ☕`,
    `Hai${name}, kalau masih mau order tinggal chat aja ya 😊`,
  ];
  return templates[Math.floor(Math.random() * templates.length)];
}

async function loadNudgeState(phone) {
  const filePath = join(NUDGE_STATE_DIR, `${phone}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { nudged: false, date: null };
  }
}

async function saveNudgeState(phone, state) {
  await mkdir(NUDGE_STATE_DIR, { recursive: true });
  const filePath = join(NUDGE_STATE_DIR, `${phone}.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

/**
 * Check OpenClaw session files for idle WA conversations.
 * Nudges ALL idle sessions (not just those with active orders).
 * Only nudges once per day per customer.
 */
export async function processIdleChats() {
  try {
    await mkdir(NUDGE_STATE_DIR, { recursive: true });
    
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    
    // Find active WA sessions
    let sessions = [];
    try {
      const { stdout } = await execFileAsync('openclaw', ['sessions', 'list', '--json', '--channel', 'whatsapp'], { timeout: 10000 });
      sessions = JSON.parse(stdout);
    } catch {
      try {
        const { stdout } = await execFileAsync('openclaw', ['sessions', 'list', '--json'], { timeout: 10000 });
        const all = JSON.parse(stdout);
        sessions = all.filter(s => s.key?.includes('whatsapp:direct:'));
      } catch (err) {
        logger.debug('[nudge] Cannot list sessions: %s', err.message);
        return;
      }
    }

    const now = Date.now();
    const today = new Date().toISOString().slice(0, 10);
    let nudged = 0;

    for (const session of sessions) {
      try {
        // Extract phone from session key
        const keyMatch = session.key?.match(/whatsapp:direct:(\+?\d+)/);
        if (!keyMatch) continue;
        const phone = keyMatch[1];

        // Check last activity
        const lastActivity = session.updatedAt || session.lastActivityAt;
        if (!lastActivity) continue;
        
        const idleMs = now - new Date(lastActivity).getTime();
        
        // Not idle enough
        if (idleMs < NUDGE_AFTER_MS) continue;
        
        // Too old — probably abandoned
        if (idleMs > MAX_AGE_MS) continue;

        // Already nudged today? Skip.
        const nudgeState = await loadNudgeState(phone);
        if (nudgeState.date === today && nudgeState.nudged) continue;

        // Check if last message was from bot (we're waiting on customer)
        if (session.transcriptPath) {
          try {
            const { stdout: tail } = await execFileAsync('tail', ['-n', '5', session.transcriptPath], { timeout: 5000 });
            const lines = tail.trim().split('\n').filter(Boolean);
            const lastLine = lines[lines.length - 1];
            if (lastLine) {
              const parsed = JSON.parse(lastLine);
              if (parsed.role !== 'assistant') continue;
            }
          } catch {
            continue;
          }
        }

        // Load customer name for personalized nudge
        let customerName = null;
        try {
          const custFile = join('/home/ubuntu/workspace-sobatngupi/state/customers', phone + '.json');
          const custRaw = await readFile(custFile, 'utf8');
          customerName = JSON.parse(custRaw).name || null;
        } catch (_) {}

        // Send nudge (1x only)
        const message = getNudgeMessage(customerName);
        const sent = await sendWa(phone, message);
        if (sent) {
          nudged++;
          await saveNudgeState(phone, { nudged: true, lastNudgeAt: new Date().toISOString(), date: today });
          logger.info('[nudge] Reminder sent to %s (idle %dmin)', phone, Math.round(idleMs / 60000));
        }
      } catch (err) {
        logger.debug('[nudge] Error processing session: %s', err.message);
      }
    }

    if (nudged > 0) {
      logger.info('[nudge] Sent %d idle chat reminders', nudged);
    }
  } catch (err) {
    logger.warn('[nudge] processIdleChats error: %s', err.message);
  }
}
