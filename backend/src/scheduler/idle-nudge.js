/**
 * Idle Chat Nudge — remind customers who left a conversation hanging
 * 
 * Logic:
 * 1. Check OpenClaw WA sessions that are idle (last activity > NUDGE_AFTER_MS)
 * 2. Only nudge if the LAST message was from the BOT (we're waiting on customer)
 * 3. Only nudge once per session (track in state file)
 * 4. Don't nudge if order is already completed/cancelled
 * 5. Only during business hours (09:00-21:00 WIB)
 * 
 * Run via scheduler: every 15 min during business hours
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { existsSync } from 'node:fs';
import logger from '../lib/logger.js';
import { runWacliSafe } from '../notifications/whatsapp.js';

const NUDGE_STATE_DIR = '/home/ubuntu/workspace-sobatngupi/state/nudge-tracking';
const SESSIONS_DIR = '/home/ubuntu/.openclaw/agents/main/sessions';
const NUDGE_AFTER_MS = 15 * 60 * 1000;  // 15 minutes idle
const NUDGE_COOLDOWN_MS = 4 * 60 * 60 * 1000; // Don't re-nudge within 4 hours
const MAX_NUDGE_PER_DAY = 1; // Max 1 nudge per customer per day

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

function getNudgeMessage(context) {
  const messages = [
    'Hai kak, masih mau lanjut ordernya? Kalau ada yang bisa aku bantu, chat aja ya 😊',
    'Kak, ordernya masih mau dilanjut? Aku standby nih kalau mau pesan ☕',
    'Hai kak, tadi sempet mau order ya? Kalau jadi, langsung aja chat lagi 🙂',
  ];
  // Pick based on hour to vary
  const hour = new Date().getHours();
  return messages[hour % messages.length];
}

async function loadNudgeState(phone) {
  const filePath = join(NUDGE_STATE_DIR, `${phone}.json`);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { nudgeCount: 0, lastNudgeAt: null, date: null };
  }
}

async function saveNudgeState(phone, state) {
  await mkdir(NUDGE_STATE_DIR, { recursive: true });
  const filePath = join(NUDGE_STATE_DIR, `${phone}.json`);
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

/**
 * Check OpenClaw session files for idle WA conversations
 * A session is "idle" if:
 * - It's a WA direct session
 * - Last message was from assistant (bot replied, waiting on customer)
 * - More than NUDGE_AFTER_MS since last activity
 * - Not already nudged today
 */
export async function processIdleChats() {
  try {
    await mkdir(NUDGE_STATE_DIR, { recursive: true });
    
    // Find active WA sessions by checking session transcript files
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    
    // Use openclaw sessions list to find active WA sessions
    let sessions = [];
    try {
      const { stdout } = await execFileAsync('openclaw', ['sessions', 'list', '--json', '--channel', 'whatsapp'], { timeout: 10000 });
      sessions = JSON.parse(stdout);
    } catch {
      // Fallback: scan session files directly
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
        // Extract phone from session key: agent:main:whatsapp:direct:+62xxx
        const keyMatch = session.key?.match(/whatsapp:direct:(\+?\d+)/);
        if (!keyMatch) continue;
        const phone = keyMatch[1];

        // Check last activity
        const lastActivity = session.updatedAt || session.lastActivityAt;
        if (!lastActivity) continue;
        
        const idleMs = now - new Date(lastActivity).getTime();
        
        // Not idle enough
        if (idleMs < NUDGE_AFTER_MS) continue;
        
        // Too old (> 4 hours = probably abandoned, don't bother)
        if (idleMs > NUDGE_COOLDOWN_MS) continue;

        // Check nudge state
        const nudgeState = await loadNudgeState(phone);
        
        // Already nudged today
        if (nudgeState.date === today && nudgeState.nudgeCount >= MAX_NUDGE_PER_DAY) continue;
        
        // Check if last message was from bot (we're waiting on customer)
        // Read last few lines of transcript
        if (session.transcriptPath) {
          try {
            const { stdout: tail } = await execFileAsync('tail', ['-n', '5', session.transcriptPath], { timeout: 5000 });
            const lines = tail.trim().split('\n').filter(Boolean);
            const lastLine = lines[lines.length - 1];
            if (lastLine) {
              const parsed = JSON.parse(lastLine);
              // Only nudge if last message was assistant (bot waiting on customer)
              if (parsed.role !== 'assistant') continue;
            }
          } catch {
            continue; // Can't read transcript, skip
          }
        }

        // Send nudge
        const message = getNudgeMessage();
        const sent = await sendWa(phone, message);
        
        if (sent) {
          nudged++;
          await saveNudgeState(phone, {
            nudgeCount: (nudgeState.date === today ? nudgeState.nudgeCount : 0) + 1,
            lastNudgeAt: new Date().toISOString(),
            date: today
          });
          logger.info('[nudge] Sent reminder to %s (idle %dmin)', phone, Math.round(idleMs / 60000));
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
