import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken } from '../middleware/auth';
import { notificationService } from '../services/notificationService';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

interface AuthedRequest extends Request {
  userId?: string;
}

const router = Router();

function getUploadsRoot() {
  return path.resolve(__dirname, '../../../uploads');
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const ticketId = (req as any).params?.id || 'misc';
    const uploadPath = path.resolve(getUploadsRoot(), `support/ticket-${String(ticketId)}`);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

function getAttachmentMeta(file: any) {
  if (!file) {
    return { attachmentUrl: null, attachmentName: null, attachmentType: null };
  }

  const absolutePath = path.resolve(String(file.path || ''));
  const uploadsRoot = getUploadsRoot();
  const relativePath = path.relative(uploadsRoot, absolutePath).replace(/\\/g, '/');
  const mime = String(file.mimetype || '');

  const attachmentType = mime.startsWith('image/')
    ? 'image'
    : mime.startsWith('video/')
      ? 'video'
      : 'file';

  return {
    attachmentUrl: relativePath || null,
    attachmentName: file.originalname || null,
    attachmentType,
  };
}

async function isAdmin(userId: string): Promise<boolean> {
  const result = await pool.query('SELECT role FROM users WHERE id::text = $1', [userId]);
  return result.rows[0]?.role === 'admin';
}

async function getTicketForAccess(ticketId: string, userId: string) {
  const result = await pool.query('SELECT * FROM support_tickets WHERE id::text = $1', [ticketId]);
  const ticket = result.rows[0];
  if (!ticket) return null;
  if (String(ticket.user_id) === String(userId)) return ticket;
  if (await isAdmin(userId)) return ticket;
  return 'forbidden';
}

const CATEGORY_LABELS: Record<string, string> = {
  booking: 'Booking',
  payment: 'Payment',
  account: 'Account',
  other: 'Other',
};

// Create a support ticket (opens the conversation)
router.post('/tickets', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { message, booking_id, category } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    let bookingId: string | null = null;
    if (booking_id) {
      const bookingRes = await pool.query(
        'SELECT id, client_id, provider_id FROM bookings WHERE id::text = $1',
        [booking_id]
      );
      const booking = bookingRes.rows[0];
      if (booking && (String(booking.client_id) === String(userId) || String(booking.provider_id) === String(userId))) {
        bookingId = booking.id;
      }
    }

    const normalizedCategory = CATEGORY_LABELS[category] ? category : null;
    const trimmedMessage = message.trim();
    const subject = `${normalizedCategory ? CATEGORY_LABELS[normalizedCategory] : 'General'}: ${trimmedMessage.slice(0, 60)}`;

    const result = await pool.query(
      `INSERT INTO support_tickets (user_id, booking_id, subject, message, category)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, bookingId, subject, trimmedMessage, normalizedCategory]
    );
    const ticket = result.rows[0];

    const messageResult = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_id, sender_role, content)
       VALUES ($1, $2, 'user', $3)
       RETURNING *`,
      [ticket.id, userId, trimmedMessage]
    );

    return res.status(201).json({ data: { ticket, message: messageResult.rows[0] } });
  } catch (error) {
    console.error('Error creating support ticket:', error);
    return res.status(500).json({ error: 'Failed to submit support ticket' });
  }
});

// Get the current user's own tickets (conversation list)
router.get('/tickets/my', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const offset = parseInt(req.query.offset as string) || 0;

    const result = await pool.query(
      `SELECT t.*, s.title as service_title,
              lm.content as last_message, lm.created_at as last_message_at,
              (SELECT COUNT(*) FROM support_messages um
                WHERE um.ticket_id::text = t.id::text AND um.sender_role <> 'user' AND um.read_at IS NULL) as unread_count
       FROM support_tickets t
       LEFT JOIN bookings b ON b.id::text = t.booking_id::text
       LEFT JOIN services s ON s.id::text = b.service_id::text
       LEFT JOIN LATERAL (
         SELECT content, created_at FROM support_messages m
         WHERE m.ticket_id::text = t.id::text
         ORDER BY m.created_at DESC LIMIT 1
       ) lm ON true
       WHERE t.user_id::text = $1
       ORDER BY COALESCE(lm.created_at, t.created_at) DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) as total FROM support_tickets WHERE user_id::text = $1',
      [userId]
    );

    return res.json({
      data: result.rows.map((r: any) => ({ ...r, unread_count: parseInt(r.unread_count) || 0 })),
      meta: { total: parseInt(countResult.rows[0].total), limit, offset },
    });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    return res.status(500).json({ error: 'Failed to fetch support tickets' });
  }
});

// Recent bookings for the intake chip picker
router.get('/bookings', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await pool.query(
      `SELECT b.id, b.status, b.start_date, s.title as service_title
       FROM bookings b
       LEFT JOIN services s ON s.id::text = b.service_id::text
       WHERE b.client_id::text = $1 OR b.provider_id::text = $1
       ORDER BY b.created_at DESC
       LIMIT 10`,
      [userId]
    );

    return res.json({ data: result.rows });
  } catch (error) {
    console.error('Error fetching bookings for support intake:', error);
    return res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Get a ticket's message thread
router.get('/tickets/:id/messages', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const ticketId = req.params.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const ticket = await getTicketForAccess(ticketId, userId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket === 'forbidden') return res.status(403).json({ error: 'Access denied' });

    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
    const msgs = await pool.query(
      `SELECT * FROM support_messages WHERE ticket_id::text = $1 ORDER BY created_at DESC LIMIT $2`,
      [ticketId, limit]
    );
    msgs.rows.reverse();

    const viewerIsAdmin = await isAdmin(userId);
    const readerRole = viewerIsAdmin ? 'user' : 'admin';
    await pool.query(
      `UPDATE support_messages SET read_at = CURRENT_TIMESTAMP
       WHERE ticket_id::text = $1 AND sender_role = $2 AND read_at IS NULL`,
      [ticketId, readerRole]
    );

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`support:${ticketId}`).emit('support:read', {
        ticketId,
        readerId: String(userId),
        readAt: new Date().toISOString(),
      });
    }

    return res.json({ data: { ticket, messages: msgs.rows } });
  } catch (error) {
    console.error('Error fetching support thread:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message in a ticket's thread
router.post('/tickets/:id/messages', verifyToken, upload.single('file'), async (req: AuthedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const ticketId = req.params.id;
    const content = String((req.body as any)?.content || '').trim();
    const file = (req as any).file as any;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!content && !file) return res.status(400).json({ error: 'Missing content or file' });

    const ticket = await getTicketForAccess(ticketId, userId);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (ticket === 'forbidden') return res.status(403).json({ error: 'Access denied' });

    const viewerIsAdmin = await isAdmin(userId);
    const senderRole = viewerIsAdmin ? 'admin' : 'user';
    const { attachmentUrl, attachmentName, attachmentType } = getAttachmentMeta(file);

    const insert = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_id, sender_role, content, attachment_url, attachment_type, attachment_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [ticketId, userId, senderRole, content || null, attachmentUrl, attachmentType, attachmentName]
    );
    const sent = insert.rows[0];

    const statusUpdate =
      senderRole === 'admin' && ticket.status === 'open'
        ? await pool.query(
            `UPDATE support_tickets SET status = 'in_progress', updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING *`,
            [ticketId]
          )
        : await pool.query(
            `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING *`,
            [ticketId]
          );
    const updatedTicket = statusUpdate.rows[0];

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`support:${ticketId}`).emit('support:message', { ticketId, message: sent, ticketStatus: updatedTicket.status });
    }

    try {
      if (senderRole === 'admin') {
        await notificationService.create({
          userId: String(ticket.user_id),
          type: 'system',
          title: 'Support replied to your ticket',
          message: content ? content.substring(0, 100) : 'Sent an attachment',
          data: { action: 'support_message', ticket_id: ticketId },
        });
      }
    } catch (notifError) {
      console.error('Failed to send support notification:', notifError);
    }

    return res.status(201).json({ data: sent });
  } catch (error) {
    console.error('Error sending support message:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
