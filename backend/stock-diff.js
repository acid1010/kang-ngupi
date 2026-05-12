#!/usr/bin/env node

/**
 * Stock Diff — Compare two snapshots and report changes.
 * 
 * Usage: 
 *   node stock-diff.js                    → compare latest morning vs evening (today)
 *   node stock-diff.js <file1> <file2>    → compare two specific snapshot files
 *   node stock-diff.js --last             → compare last 2 snapshots available
 * 
 * Output: JSON with newlyUnavailable, newlyAvailable arrays
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = join(__dirname, 'data', 'stock-snapshots');

function getWIBDate() {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function loadSnapshot(filepath) {
  return JSON.parse(readFileSync(filepath, 'utf8'));
}

function diff(before, after) {
  const beforeMap = new Map(before.items.map(i => [i.name, i.available]));
  const afterMap = new Map(after.items.map(i => [i.name, i.available]));

  const newlyUnavailable = [];
  const newlyAvailable = [];

  for (const [name, avail] of afterMap) {
    const prev = beforeMap.get(name);
    if (prev === undefined) continue; // new item, skip
    if (prev === true && avail === false) {
      newlyUnavailable.push(name);
    }
    if (prev === false && avail === true) {
      newlyAvailable.push(name);
    }
  }

  return {
    before: { file: before._file, date: before.date, tag: before.tag, available: before.available, unavailable: before.unavailable },
    after: { file: after._file, date: after.date, tag: after.tag, available: after.available, unavailable: after.unavailable },
    newlyUnavailable,
    newlyAvailable,
    hasChanges: newlyUnavailable.length > 0 || newlyAvailable.length > 0
  };
}

function run() {
  const args = process.argv.slice(2);

  let before, after;

  if (args.length === 2 && !args[0].startsWith('--')) {
    // Explicit files
    before = loadSnapshot(args[0]);
    before._file = args[0];
    after = loadSnapshot(args[1]);
    after._file = args[1];
  } else {
    // Auto: find last 2 snapshots
    let files;
    try {
      files = readdirSync(SNAPSHOT_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();
    } catch (e) {
      console.log(JSON.stringify({ error: 'No snapshots found', hasChanges: false }));
      process.exit(0);
    }

    if (args[0] === '--last' || args.length === 0) {
      if (files.length < 2) {
        console.log(JSON.stringify({ error: 'Need at least 2 snapshots to compare', hasChanges: false, snapshotsFound: files.length }));
        process.exit(0);
      }
      const f1 = files[files.length - 2];
      const f2 = files[files.length - 1];
      before = loadSnapshot(join(SNAPSHOT_DIR, f1));
      before._file = f1;
      after = loadSnapshot(join(SNAPSHOT_DIR, f2));
      after._file = f2;
    } else {
      // Default: today morning vs evening
      const date = getWIBDate();
      const morningFile = `${date}-morning.json`;
      const eveningFile = `${date}-evening.json`;
      try {
        before = loadSnapshot(join(SNAPSHOT_DIR, morningFile));
        before._file = morningFile;
      } catch (e) {
        console.log(JSON.stringify({ error: `Morning snapshot not found: ${morningFile}`, hasChanges: false }));
        process.exit(0);
      }
      try {
        after = loadSnapshot(join(SNAPSHOT_DIR, eveningFile));
        after._file = eveningFile;
      } catch (e) {
        console.log(JSON.stringify({ error: `Evening snapshot not found: ${eveningFile}`, hasChanges: false }));
        process.exit(0);
      }
    }
  }

  const result = diff(before, after);
  console.log(JSON.stringify(result, null, 2));
}

run();
