import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Create a support ticket
router.post('/tickets', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    const { subject, message, booking_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: 'Subject is required' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let bookingId: string | null = null;
    if (booking_id) {
      // Only allow attaching a booking the requester is actually part of.
      const bookingRes = await pool.query(
        'SELECT id, client_id, provider_id FROM bookings WHERE id::text = $1',
        [booking_id]
      );
      const booking = bookingRes.rows[0];
      if (booking && (String(booking.client_id) === String(userId) || String(booking.provider_id) === String(userId))) {
        bookingId = booking.id;
      }
    }

    const result = await pool.query(
      `INSERT INTO support_tickets (user_id, booking_id, subject, message)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, bookingId, subject.trim(), message.trim()]
    );

    return res.status(201).json({ data: result.rows[0] });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    return res.status(500).json({ error: 'Failed to submit support ticket' });
  }
});

// Get the current user's own tickets
router.get('/tickets/my', verifyToken, async (req: Request & { userId?: string }, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await pool.query(
      `SELECT t.*, s.title as service_title
       FROM support_tickets t
       LEFT JOIN bookings b ON b.id::text = t.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       WHERE t.user_id::text = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM support_tickets WHERE user_id::text = $1',
      [userId]
    );

    return res.json({
      data: result.rows,
      meta: { total: parseInt(countResult.rows[0].total), limit, offset },
    });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    return res.status(500).json({ error: 'Failed to fetch support tickets' });
  }
});

export default router;
