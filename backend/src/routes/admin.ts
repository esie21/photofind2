import { Router, Request, Response } from 'express';
import { verifyToken, checkRole } from '../middleware/auth';
import pool from '../config/database';

const router = Router();

// Example admin-only endpoint returning counts
router.get('/stats', verifyToken, checkRole('admin'), async (req: Request, res: Response) => {
  try {
    const { rows: userCountRows } = await pool.query('SELECT COUNT(*) FROM users');
    const { rows: serviceCountRows } = await pool.query('SELECT COUNT(*) FROM services');
    const userCount = userCountRows[0].count;
    const serviceCount = serviceCountRows[0].count;
    res.json({ userCount, serviceCount });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to fetch admin stats' });
  }
});

export default router;
