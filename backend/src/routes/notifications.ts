import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Notification types
export type NotificationType =
  | 'booking_request'      // New booking request (to provider)
  | 'booking_accepted'     // Booking accepted (to client)
  | 'booking_rejected'     // Booking rejected (to client)
  | 'booking_cancelled'    // Booking cancelled (to both)
  | 'booking_completed'    // Booking marked complete (to both)
  | 'payment_received'     // Payment successful (to provider)
  | 'payment_failed'       // Payment failed (to client)
  | 'payout_approved'      // Payout approved (to provider)
  | 'payout_completed'     // Payout sent (to provider)
  | 'payout_rejected'      // Payout rejected (to provider)
  | 'new_message'          // New chat message
  | 'new_review'           // New review received (to provider)
  | 'system';              // System notification

export interface NotificationData {
  booking_id?: string | number;
  payment_id?: string | number;
  payout_id?: string | number;
  chat_id?: string | number;
  sender_id?: string | number;
  sender_name?: string;
  amount?: number;
  [key: string]: any;
}

// Get notifications for current user
router.get('/', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);
    const unreadOnly = req.query.unread === 'true';

    let sql = `
      SELECT id, type, title, message, data, read_at, created_at
      FROM notifications
      WHERE user_id = $1
    `;
    const values: any[] = [userId];

    if (unreadOnly) {
      sql += ` AND read_at IS NULL`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(limit, offset);

    const result = await pool.query(sql, values);

    // Get total count
    let countSql = `SELECT COUNT(*) as total FROM notifications WHERE user_id = $1`;
    if (unreadOnly) {
      countSql += ` AND read_at IS NULL`;
    }
    const countResult = await pool.query(countSql, [userId]);
    const total = parseInt(countResult.rows[0].total);

    // Parse data field if it's a string (backwards compatibility for old notifications)
    const notifications = result.rows.map((row: any) => {
      if (row.data && typeof row.data === 'string') {
        try {
          row.data = JSON.parse(row.data);
        } catch (e) {
          // Keep as-is if parsing fails
        }
      }
      return row;
    });

    res.json({
      data: notifications,
      meta: { limit, offset, total }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Get unread count
router.get('/unread-count', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ error: 'Failed to get unread count' });
  }
});

// Mark single notification as read
router.patch('/:id/read', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const notificationId = req.params.id;

    const result = await pool.query(
      `UPDATE notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2 AND read_at IS NULL
       RETURNING *`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found or already read' });
    }

    res.json({ data: result.rows[0] });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.patch('/read-all', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `UPDATE notifications
       SET read_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND read_at IS NULL
       RETURNING id`,
      [userId]
    );

    res.json({
      message: 'All notifications marked as read',
      count: result.rowCount
    });
  } catch (error) {
    console.error('Mark all read error:', error);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// Delete a notification
router.delete('/:id', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const notificationId = req.params.id;

    const result = await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [notificationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Clear all notifications
router.delete('/', verifyToken, async (req: any, res: Response) => {
  try {
    const userId = req.userId;

    const result = await pool.query(
      `DELETE FROM notifications WHERE user_id = $1 RETURNING id`,
      [userId]
    );

    res.json({
      message: 'All notifications cleared',
      count: result.rowCount
    });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

export default router;
