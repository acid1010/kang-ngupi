/**
 * Dashboard Router — mounts auth + orders API under /dashboard/api
 */

import { Router } from 'express';
import { authenticateUser, createUser, authMiddleware, adminOnly } from './auth.js';
import ordersRouter from './orders.js';

const router = Router();

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
