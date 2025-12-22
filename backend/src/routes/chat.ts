import { Router, Response, Request } from 'express';
import { verifyToken } from '../middleware/auth';
import { pool } from '../config/database';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { notificationService } from '../services/notificationService';

interface AuthedRequest extends Request {
  userId?: string;
}

type BookingRow = {
  id: string;
  client_id: string;
  provider_id: string;
  provider_user_id?: string | null;
};

type ChatRow = {
  id: string;
  booking_id: string | null;
  user_a?: string | null;
  user_b?: string | null;
  client_id?: string | null;
  provider_id?: string | null;
  created_at: string;
  updated_at: string;
};

const router = Router();

function getUploadsRoot() {
  return path.resolve(__dirname, '../../../uploads');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const bookingId = (req as any).body?.booking_id || (req as any).query?.booking_id;
    const safeBookingId = String(bookingId || 'unknown');
    const uploadPath = path.resolve(getUploadsRoot(), `chats/${safeBookingId}`);
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({ storage });

let chatsSchemaMode: 'client_provider' | 'user_a_b' | null = null;

async function getChatsSchemaMode() {
  if (chatsSchemaMode) return chatsSchemaMode;

  try {
    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'chats'
      `
    );
    const names = new Set<string>(cols.rows.map((r: any) => String(r.column_name)));
    if (names.has('client_id') && names.has('provider_id')) {
      chatsSchemaMode = 'client_provider';
    } else {
      chatsSchemaMode = 'user_a_b';
    }
  } catch (_e) {
    chatsSchemaMode = 'user_a_b';
  }

  return chatsSchemaMode;
}

async function getBookingWithProviderUser(bookingId: string): Promise<BookingRow | null> {
  try {
    const result = await pool.query<BookingRow>(
      `
        SELECT b.id::text AS id,
               b.client_id::text AS client_id,
               b.provider_id::text AS provider_id,
               p.user_id::text AS provider_user_id
        FROM bookings b
        LEFT JOIN providers p ON p.id::text = b.provider_id::text
        WHERE b.id::text = $1
        LIMIT 1
      `,
      [bookingId]
    );
    return result.rows[0] || null;
  } catch (_e) {
    const result = await pool.query<BookingRow>(
      'SELECT id::text AS id, client_id::text AS client_id, provider_id::text AS provider_id FROM bookings WHERE id::text = $1 LIMIT 1',
      [bookingId]
    );
    return result.rows[0] || null;
  }
}

async function getBookingForUser(bookingId: string, userId: string) {
  const booking = await getBookingWithProviderUser(bookingId);
  if (!booking) return null;
  const providerUserId = String(booking.provider_user_id || booking.provider_id || '');
  if (String(booking.client_id) !== String(userId) && providerUserId !== String(userId)) return 'forbidden';
  return booking;
}

async function ensureBookingChatExists(booking: BookingRow): Promise<ChatRow> {
  const mode = await getChatsSchemaMode();
  const providerUserId = String(booking.provider_user_id || booking.provider_id || '');

  const existing = await pool.query<ChatRow>(
    'SELECT * FROM chats WHERE booking_id::text = $1',
    [String(booking.id)]
  );
  if (existing.rows[0]) return existing.rows[0];

  const created =
    mode === 'client_provider'
      ? await pool.query<ChatRow>(
          `
            INSERT INTO chats (booking_id, client_id, provider_id)
            VALUES ($1, $2, $3)
            RETURNING *
          `,
          [String(booking.id), String(booking.client_id), String(booking.provider_id)]
        )
      : await pool.query<ChatRow>(
          `
            INSERT INTO chats (booking_id, user_a, user_b)
            VALUES ($1, $2, $3)
            RETURNING *
          `,
          [String(booking.id), String(booking.client_id), providerUserId]
        );
  return created.rows[0];
}

async function insertSystemMessage(chatId: string, content: string) {
  const inserted = await pool.query(
    `
      INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
      VALUES ($1, NULL, $2, TRUE)
      RETURNING id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
    `,
    [chatId, content]
  );
  await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [chatId]);
  return inserted.rows[0];
}

router.get('/history', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const bookingId = String(req.query.booking_id || '');
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!bookingId) return res.status(400).json({ error: 'Missing booking_id' });

    const booking = await getBookingForUser(bookingId, String(currentUserId));
    if (booking === null) return res.status(404).json({ error: 'Booking not found' });
    if (booking === 'forbidden') return res.status(403).json({ error: 'Access denied' });

    const chat = await ensureBookingChatExists(booking);

    const msgs = await pool.query(
      `
        SELECT id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
        FROM chat_messages
        WHERE chat_id = $1
        ORDER BY created_at ASC
        LIMIT $2
      `,
      [chat.id, limit]
    );

    // Mark other user's unread messages as read when history is fetched
    await pool.query(
      `
        UPDATE chat_messages
        SET read_at = CURRENT_TIMESTAMP
        WHERE chat_id = $1
          AND sender_id IS NOT NULL
          AND sender_id <> $2
          AND read_at IS NULL
      `,
      [String(chat.id), String(currentUserId)]
    );

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`booking:${bookingId}`).emit('chat:read', {
        bookingId,
        readerId: String(currentUserId),
        readAt: new Date().toISOString(),
      });
    }

    return res.json({
      data: {
        chat: { id: chat.id, booking_id: chat.booking_id, user_a: chat.user_a, user_b: chat.user_b },
        messages: msgs.rows,
      },
    });
  } catch (error) {
    console.error('Error fetching chat history:', error);
    return res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

router.post('/send', verifyToken, upload.single('file'), async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const bookingId = String((req.body as any)?.booking_id || '');
    const content = String((req.body as any)?.content || '').trim();
    const file = (req as any).file as any;

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!bookingId) return res.status(400).json({ error: 'Missing booking_id' });
    if (!content && !file) return res.status(400).json({ error: 'Missing content or file' });

    const booking = await getBookingForUser(bookingId, String(currentUserId));
    if (booking === null) return res.status(404).json({ error: 'Booking not found' });
    if (booking === 'forbidden') return res.status(403).json({ error: 'Access denied' });

    const chat = await ensureBookingChatExists(booking);

    const attachmentUrl = file ? `chats/${bookingId}/${file.filename}` : null;
    const attachmentName = file ? file.originalname : null;
    const attachmentType = file
      ? file.mimetype.startsWith('image/')
        ? 'image'
        : 'file'
      : null;

    const insert = await pool.query(
      `
        INSERT INTO chat_messages (
          chat_id,
          sender_id,
          content,
          attachment_url,
          attachment_type,
          attachment_name,
          is_system
        )
        VALUES ($1, $2, $3, $4, $5, $6, FALSE)
        RETURNING id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
      `,
      [
        String(chat.id),
        String(currentUserId),
        content || null,
        attachmentUrl,
        attachmentType,
        attachmentName,
      ]
    );

    await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [String(chat.id)]);

    const sent = insert.rows[0];

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`booking:${bookingId}`).emit('chat:message', {
        bookingId,
        message: sent,
      });
    }

    // Send notification to the other party
    try {
      const providerUserId = String(booking.provider_user_id || booking.provider_id || '');
      const recipientId = String(currentUserId) === String(booking.client_id)
        ? providerUserId
        : String(booking.client_id);

      // Get sender name
      const senderInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
      const senderName = senderInfo.rows[0]?.name || 'Someone';

      await notificationService.notifyNewMessage(
        recipientId,
        bookingId,
        senderName,
        content?.substring(0, 100) || (file ? 'Sent an attachment' : 'New message')
      );
    } catch (notifError) {
      console.error('Failed to send chat notification:', notifError);
    }

    return res.status(201).json({ data: sent });
  } catch (error) {
    console.error('Error sending chat message:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

router.post('/system/booking-status', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const bookingId = String(req.body?.booking_id || '');
    const status = String(req.body?.status || '').trim();

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!bookingId || !status) return res.status(400).json({ error: 'Missing booking_id or status' });

    const booking = await getBookingForUser(bookingId, String(currentUserId));
    if (booking === null) return res.status(404).json({ error: 'Booking not found' });
    if (booking === 'forbidden') return res.status(403).json({ error: 'Access denied' });

    const chat = await ensureBookingChatExists(booking);
    const sys = await insertSystemMessage(chat.id, `Booking status updated to ${status}.`);

    const io = (req.app as any).get('io');
    if (io) {
      io.to(`booking:${bookingId}`).emit('chat:message', {
        bookingId,
        message: sys,
      });
    }

    return res.status(201).json({ data: sys });
  } catch (error) {
    console.error('Error creating system booking-status message:', error);
    return res.status(500).json({ error: 'Failed to create system message' });
  }
});

export default router;
