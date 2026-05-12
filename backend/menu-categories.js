#!/usr/bin/env node
/**
 * Return menu categories list for bot display.
 * Usage: node backend/menu-categories.js
 * Output: formatted category list ready to paste in WA reply
 */
import { readFileSync } from 'fs';
const schema = JSON.parse(readFileSync('/home/ubuntu/workspace-sobatngupi/menu-schema.json', 'utf8'));
const categories = schema.categories.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
console.log(categories);
