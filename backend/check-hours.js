#!/usr/bin/env node

/**
 * Check if Kang Ngupi (bot) and Kedai are currently open.
 * 
 * Kang Ngupi (bot order hours):
 * - Weekday (Mon-Fri): 08:30 - 22:00 WIB
 * - Weekend (Sat-Sun): 07:30 - 22:30 WIB
 * 
 * Kedai (physical store hours):
 * - Weekday (Mon-Fri): 09:00 - 23:00 WIB
 * - Weekend (Sat-Sun): 08:00 - 23:30 WIB
 * 
 * Delivery cutoff: 21:00 WIB (all days)
 * Reservasi: ngikutin jam Kang Ngupi
 * 
 * Output: JSON { botOpen, kedaiOpen, botOpensAt, botClosesAt, kedaiOpensAt, kedaiClosesAt, currentTimeWIB, isWeekend, deliveryOpen }
 */

const now = new Date();
const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
const hours = wib.getHours();
const minutes = wib.getMinutes();
const currentMinutes = hours * 60 + minutes;
const day = wib.getDay(); // 0=Sun, 6=Sat
const isWeekend = day === 0 || day === 6;

// Kang Ngupi (bot) hours
const botOpensAt = isWeekend ? '07:30' : '08:30';
const botClosesAt = isWeekend ? '22:30' : '22:00';
const botOpenMin = isWeekend ? 7 * 60 + 30 : 8 * 60 + 30;
const botCloseMin = isWeekend ? 22 * 60 + 30 : 22 * 60;
const botOpen = currentMinutes >= botOpenMin && currentMinutes < botCloseMin;

// Kedai (physical store) hours
const kedaiOpensAt = isWeekend ? '08:00' : '09:00';
const kedaiClosesAt = isWeekend ? '23:30' : '23:00';
const kedaiOpenMin = isWeekend ? 8 * 60 : 9 * 60;
const kedaiCloseMin = isWeekend ? 23 * 60 + 30 : 23 * 60;
const kedaiOpen = currentMinutes >= kedaiOpenMin && currentMinutes < kedaiCloseMin;

const deliveryOpen = botOpen && currentMinutes < 21 * 60; // only during bot hours AND before 21:00

const timeStr = wib.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Backward compat: "open" = botOpen (used by agent)
console.log(JSON.stringify({
  open: botOpen,
  botOpen,
  kedaiOpen,
  botOpensAt,
  botClosesAt,
  kedaiOpensAt,
  kedaiClosesAt,
  currentTimeWIB: timeStr,
  isWeekend,
  deliveryOpen
}));
