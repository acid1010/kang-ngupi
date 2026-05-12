#!/usr/bin/env node

/**
 * Stock Snapshot — Save current menu availability state for later diffing.
 * 
 * Usage: node stock-snapshot.js [tag]
 * 
 * Saves to: backend/data/stock-snapshots/<YYYY-MM-DD>-<tag>.json
 * Default tag: "morning" or "evening" based on current WIB hour.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MENU_PATH = join(__dirname, '..', 'menu-schema.json');
const SNAPSHOT_DIR = join(__dirname, 'data', 'stock-snapshots');

function getWIBDate() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return {
    date: wib.toISOString().slice(0, 10),
    hour: wib.getUTCHours()
  };
}

function run() {
  const tag = process.argv[2] || (getWIBDate().hour < 14 ? 'morning' : 'evening');
  const { date } = getWIBDate();

  const menu = JSON.parse(readFileSync(MENU_PATH, 'utf8'));
  const snapshot = {
    date,
    tag,
    createdAt: new Date().toISOString(),
    totalItems: menu.menus.length,
    available: menu.menus.filter(m => m.available).length,
    unavailable: menu.menus.filter(m => !m.available).length,
    items: menu.menus.map(m => ({
      name: m.name,
      category: m.category,
      available: !!m.available
    }))
  };

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const filename = `${date}-${tag}.json`;
  writeFileSync(join(SNAPSHOT_DIR, filename), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({
    saved: filename,
    available: snapshot.available,
    unavailable: snapshot.unavailable
  }));
}

run();
