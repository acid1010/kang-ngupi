/**
 * Dashboard Auth — JWT-based authentication for dashboard users
 * Users stored in local JSON file (can migrate to Supabase later)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
const USERS_FILE = join(__dirname, '..', '..', 'data', 'dashboard-users.json');
const JWT_SECRET = process.env.DASHBOARD_JWT_SECRET || 'ngupi-dashboard-secret-change-me';
const JWT_EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 10;

// Legacy hash for migration
function legacyHash(password) {
  return createHash('sha256').update(password + 'ngupi-salt').digest('hex');
}

function loadUsers() {
  if (!existsSync(USERS_FILE)) return [];
  return JSON.parse(readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export async function createUser({ username, password, role = 'kurir', name = '' }) {
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    throw new Error('Username already exists');
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = {
    id: randomUUID(),
    username,
    passwordHash,
    hashType: 'bcrypt',
    role,
    name,
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  return { id: user.id, username, role, name };
}

export async function authenticateUser(username, password) {
  const users = loadUsers();
  const user = users.find(u => u.username === username);
  if (!user) return null;

  let valid = false;

  if (user.hashType === 'bcrypt') {
    // Modern bcrypt check
    valid = await bcrypt.compare(password, user.passwordHash);
  } else {
    // Legacy SHA-256 check + auto-migrate to bcrypt
    valid = user.passwordHash === legacyHash(password);
    if (valid) {
      // Migrate to bcrypt
      user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      user.hashType = 'bcrypt';
      saveUsers(users);
    }
  }

  if (!valid) return null;

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
  return { token, user: { id: user.id, username: user.username, role: user.role, name: user.name } };
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function authMiddleware(req, res, next) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query?.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Missing authorization token' });
  }
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ ok: false, error: 'Invalid or expired token' });
  }
  req.user = decoded;
  next();
}

export function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ ok: false, error: 'Admin access required' });
  }
  next();
}
