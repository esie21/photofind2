import { Router } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';

const router = Router();

// Dev-only route to list users (no password hash)
router.get('/users', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const result = await pool.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Debug users error:', error);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

export default router;

// Dev-only endpoint to reset a user's password (only in non-production)
router.post('/reset-password', async (req, res) => {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id, email', [hashed, email]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, email: result.rows[0].email });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Reset failed' });
  }
});
