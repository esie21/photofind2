import { Router, Request, Response } from 'express';
import pool from '../config/database';
import { verifyToken } from '../middleware/auth';
import { notificationService } from '../services/notificationService';
import { auditService } from '../services/auditService';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import {
  UPLOADS_ROOT,
  MAX_FILE_SIZE,
  safeSegment,
  resolveInsideRoot,
  generateFilename,
  documentFileFilter,
  discardUploads,
  verifyUploadedContent,
  handleUpload,
} from '../services/uploadService';
import { uploadLimiter } from '../middleware/security';

interface AuthedRequest extends Request {
  userId?: string;
}

const router = Router();

function getUploadsRoot() {
  return path.resolve(__dirname, '../../../uploads');
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      // The ticket id used to go straight into the path, so '../..' escaped uploads.
      const ticketId = safeSegment((req as any).params?.id);
      const uploadPath = resolveInsideRoot(getUploadsRoot(), 'support', `ticket-${ticketId}`);
      fs.mkdirSync(uploadPath, { recursive: true });
      cb(null, uploadPath);
    } catch (e) {
      cb(e as Error, '');
    }
  },
  filename: (_req, file, cb) => {
    cb(null, generateFilename(file.mimetype));
  },
});

// Was `multer({ storage })` - no type filter and no size limit at all, so any file
// of any size was accepted (a .exe went through and was stored happily).
const upload = multer({
  storage,
  fileFilter: documentFileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
});

function getAttachmentMeta(file: any) {
  if (!file) {
    return { attachmentUrl: null, attachmentName: null, attachmentType: null };
  }

  const absolutePath = path.resolve(String(file.path || ''));
  const uploadsRoot = getUploadsRoot();
  const relativePath = path.relative(uploadsRoot, absolutePath).replace(/\\/g, '/');
  const mime = String(file.mimetype || '');

  // The video branch is unreachable for new uploads - documentFileFilter permits images
  // and PDF only. It stays because this endpoint accepted anything at all before that
  // filter was added, so rows with attachment_type 'video' can exist already, and the
  // client still needs to know how to render them.
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

/**
 * Resolves the ticket and attaches it to the request, refusing before anything else runs.
 *
 * This has to sit BEFORE multer in the message-posting chain. It used to run inside the
 * handler, which meant the attachment was already written to disk by the time anyone
 * asked whether the sender could see the ticket - and the 403 path returned without
 * deleting it. Any signed-in user could post a file against a ticket id they had no
 * access to and leave it in uploads/support/ticket-<id>/ for good. users.ts fixed the
 * same class of bug in its own upload routes; this one was missed.
 */
async function requireTicketAccess(req: any, res: Response, next: any) {
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const ticket = await getTicketForAccess(req.params.id, userId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket === 'forbidden') return res.status(403).json({ error: 'Access denied' });

  req.supportTicket = ticket;
  req.viewerIsAdmin = await isAdmin(userId);
  return next();
}

const CATEGORY_LABELS: Record<string, string> = {
  booking: 'Booking',
  payment: 'Payment',
  account: 'Account',
  other: 'Other',
};

// Both columns are TEXT and express.json accepts 10MB, so without a cap a single
// message could be megabytes of prose that no support agent could read anyway.
const MAX_MESSAGE_LENGTH = 5000;
// A person with a genuine problem does not need six open conversations at once, and
// nothing else stopped a script opening thousands.
const MAX_OPEN_TICKETS = 5;

/**
 * Tells every admin something happened on a ticket.
 *
 * Notifications only ever ran in the admin-to-user direction, so a new ticket - or a
 * reply on an existing one - reached whichever admin happened to have the dashboard
 * open at that moment, and nobody at all otherwise.
 */
async function notifyAdmins(params: { title: string; message: string; ticketId: string }) {
  const admins = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
  await Promise.all(
    admins.rows.map((admin: any) =>
      notificationService.create({
        userId: String(admin.id),
        type: 'system',
        title: params.title,
        message: params.message,
        data: { action: 'support_message', ticket_id: params.ticketId },
      })
    )
  );
}

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
    if (String(message).trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const openCount = await pool.query(
      `SELECT COUNT(*) as total FROM support_tickets
       WHERE user_id::text = $1 AND status IN ('open', 'in_progress')`,
      [userId]
    );
    if (parseInt(openCount.rows[0].total, 10) >= MAX_OPEN_TICKETS) {
      return res.status(429).json({
        error: `You already have ${MAX_OPEN_TICKETS} open conversations. Please continue in one of those instead.`,
      });
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

    try {
      await notifyAdmins({
        title: 'New support ticket',
        message: trimmedMessage.substring(0, 100),
        ticketId: String(ticket.id),
      });
    } catch (notifError) {
      // A ticket that was raised but not announced is still better than a 500 for the
      // person raising it.
      console.error('Failed to notify admins of new support ticket:', notifError);
    }

    const io = (req.app as any).get('io');
    if (io) {
      io.to('support:admin').emit('support:queue_update', { ticketId: String(ticket.id), reason: 'new_ticket' });
    }

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

    // Paged newest-first, then flipped, so the client can walk backwards through a long
    // ticket. Without an offset the thread was capped at one page and the original
    // problem description simply fell off the top of a long conversation.
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const msgs = await pool.query(
      `SELECT * FROM support_messages WHERE ticket_id::text = $1
       ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [ticketId, limit, offset]
    );
    // A full page back suggests there is more behind it.
    const hasMore = msgs.rows.length === limit;
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

    return res.json({ data: { ticket, messages: msgs.rows, hasMore } });
  } catch (error) {
    console.error('Error fetching support thread:', error);
    return res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message in a ticket's thread
router.post('/tickets/:id/messages',
  verifyToken,
  // Ordered deliberately: access is settled before multer writes anything to disk.
  requireTicketAccess,
  handleUpload(upload.single('file')),
  verifyUploadedContent,
  // After multer, not before: uploadLimiter's skip check needs req.file to tell an
  // attachment apart from a plain text reply, and it was previously counting every
  // message - even ones with no file - against the 30-per-hour upload cap.
  uploadLimiter,
  async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const ticketId = req.params.id;
    const ticket = req.supportTicket;
    const content = String((req.body as any)?.content || '').trim();
    const file = (req as any).file as any;

    if (!content && !file) return res.status(400).json({ error: 'Missing content or file' });
    if (content.length > MAX_MESSAGE_LENGTH) {
      discardUploads(req);
      return res.status(400).json({ error: `Messages must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
    }

    const senderRole = req.viewerIsAdmin ? 'admin' : 'user';
    const { attachmentUrl, attachmentName, attachmentType } = getAttachmentMeta(file);

    const insert = await pool.query(
      `INSERT INTO support_messages (ticket_id, sender_id, sender_role, content, attachment_url, attachment_type, attachment_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [ticketId, userId, senderRole, content || null, attachmentUrl, attachmentType, attachmentName]
    );
    const sent = insert.rows[0];

    // 'support.reply' has been a defined audit action since the audit log was written,
    // but nothing ever called it - every other admin action (verify, reject, delete,
    // dispute resolve, ticket status change) was in the trail except the actual content
    // of what an admin said to a user.
    if (senderRole === 'admin') {
      // log() swallows its own errors - a logging failure must never block the reply.
      await auditService.log({
        userId,
        action: 'support.reply',
        entityType: 'support_ticket',
        entityId: ticketId,
        newValues: { message_id: sent.id, content: sent.content, has_attachment: Boolean(attachmentUrl) },
        req,
      });
    }

    // An admin replying picks the ticket up. A user replying to a ticket that was marked
    // resolved reopens it - without this the status stayed 'resolved', and since the
    // admin queue filters on 'open' by default, the reply was never seen by anyone.
    let nextStatus: string | null = null;
    if (senderRole === 'admin' && ticket.status === 'open') nextStatus = 'in_progress';
    if (senderRole === 'user' && ticket.status === 'resolved') nextStatus = 'open';

    const statusUpdate = nextStatus
      ? await pool.query(
          `UPDATE support_tickets SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING *`,
          [ticketId, nextStatus]
        )
      : await pool.query(
          `UPDATE support_tickets SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1 RETURNING *`,
          [ticketId]
        );
    const updatedTicket = statusUpdate.rows[0];

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`support:${ticketId}`).emit('support:message', { ticketId, message: sent, ticketStatus: updatedTicket.status });
      // Keeps the admin queue's last-message preview and unread badge current for
      // admins who don't have this ticket open - mirrors the new-ticket broadcast above.
      io.to('support:admin').emit('support:queue_update', { ticketId, reason: 'message' });
    }

    // Notifications go both ways. Only the admin-to-user direction existed, so a user's
    // reply reached whoever happened to have the dashboard open and nobody else.
    try {
      const preview = content ? content.substring(0, 100) : 'Sent an attachment';
      if (senderRole === 'admin') {
        await notificationService.create({
          userId: String(ticket.user_id),
          type: 'system',
          title: 'Support replied to your ticket',
          message: preview,
          data: { action: 'support_message', ticket_id: ticketId },
        });
      } else {
        await notifyAdmins({
          title: nextStatus === 'open' ? 'Resolved ticket reopened' : 'New reply on a support ticket',
          message: preview,
          ticketId,
        });
      }
    } catch (notifError) {
      console.error('Failed to send support notification:', notifError);
    }

    return res.status(201).json({ data: sent });
  } catch (error) {
    console.error('Error sending support message:', error);
    // Whatever multer wrote is orphaned once the insert fails.
    discardUploads(req);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
