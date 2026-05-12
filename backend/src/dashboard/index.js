/**
 * Dashboard Router — mounts auth + orders API under /dashboard/api
 */

import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticateUser, createUser, authMiddleware, adminOnly } from './auth.js';
import ordersRouter from './orders.js';

const router = Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '../../..');

function loadMenuSchema() {
  const raw = readFileSync(path.join(ROOT_DIR, 'menu-schema.json'), 'utf8');
  return JSON.parse(raw);
}

// Public: Login
router.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }
    const result = await authenticateUser(username, password);
    if (!result) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    res.json({ ok: true, data: result });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

// Protected: All routes below require auth
router.use('/api', authMiddleware);

// Admin: Create user
router.post('/api/auth/users', adminOnly, async (req, res) => {
  try {
    const { username, password, role, name } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, error: 'Username and password required' });
    }
    const user = await createUser({ username, password, role, name });
    res.json({ ok: true, data: user });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

// Admin: Get current user info
router.get('/api/auth/me', (req, res) => {
  res.json({ ok: true, data: req.user });
});

// Orders API (protected)
router.use('/api/orders', ordersRouter);

// Menu stats API
router.get('/api/menu/stats', async (req, res) => {
  try {
    const schema = loadMenuSchema();
    const menus = Array.isArray(schema.menus) ? schema.menus : [];
    const unavailableItems = menus.filter((item) => item.available === false);
    const availableItems = menus.filter((item) => item.available !== false);

    const unavailableByCategory = unavailableItems.reduce((acc, item) => {
      const key = item.category || 'Uncategorized';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const topUnavailableCategories = Object.entries(unavailableByCategory)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([category, count]) => ({ category, count }));

    const latestUnavailable = unavailableItems
      .slice(0, 6)
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        price: item.price
      }));

    res.json({
      ok: true,
      data: {
        totalItems: menus.length,
        availableItems: availableItems.length,
        unavailableItems: unavailableItems.length,
        availabilityRate: menus.length ? Math.round((availableItems.length / menus.length) * 100) : 0,
        topUnavailableCategories,
        latestUnavailable,
        lastSyncedAt: schema.lastSyncedAt || null
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to fetch menu stats' });
  }
});

// Feedback API
router.get('/api/feedback', async (req, res) => {
  try {
    const { getSupabase } = await import('../supabase.js');
    const supabase = getSupabase();
    const { page = 1, per_page = 25 } = req.query;

    const { data, error, count } = await supabase
      .from('order_feedback')
      .select('*', { count: 'exact' })
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .range((page - 1) * per_page, page * per_page - 1);

    if (error) throw error;

    // Calculate average
    const { data: avgData } = await supabase
      .from('order_feedback')
      .select('rating')
      .eq('status', 'completed');
    const ratings = (avgData || []).map(r => r.rating).filter(Boolean);
    const avg = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;

    res.json({
      ok: true,
      data: data || [],
      meta: { total: count || 0, page: Number(page), per_page: Number(per_page), averageRating: avg ? Number(avg) : null, totalRatings: ratings.length }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to fetch feedback' });
  }
});

export default router;
