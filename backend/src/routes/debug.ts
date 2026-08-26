import { Router } from 'express';
import pool from '../config/database';
import bcrypt from 'bcryptjs';

const router = Router();

/**
 * Local development helpers. Neither route authenticates the caller, and
 * POST /reset-password rewrites any account's password given only its email - so
 * reaching these in a deployed environment is a complete account takeover, admin
 * included.
 *
 * Both the mount in server.ts and the checks below are opt-in on NODE_ENV, deliberately.
 * They used to be gated the other way round (`!== 'production'` to mount, and reject only
 * when `=== 'production'`), which fails OPEN: an environment that never sets NODE_ENV at
 * all - which is exactly what railway.json's `npm start` does, since only the unused
 * `start:prod` script sets it - satisfied both conditions and exposed these publicly.
 */
const isDevelopment = () => process.env.NODE_ENV === 'development';

// Dev-only route to list users (no password hash)
router.get('/users', async (req, res) => {
  try {
    if (!isDevelopment()) {
      return res.status(404).json({ error: 'Not found' });
    }
    const result = await pool.query('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ data: result.rows });
  } catch (error) {
    console.error('Debug users error:', error);
    res.status(500).json({ error: 'Failed to read users' });
  }
});

// Dev-only endpoint to reset a user's password
router.post('/reset-password', async (req, res) => {
  try {
    if (!isDevelopment()) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, password_set_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id, email',
      [hashed, email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, email: result.rows[0].email });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// At the end, not the middle. This sat above the reset-password route, which reads as
// though that route is not part of the exported router - it is, because the export is a
// live reference to the same mutable object.
export default router;
