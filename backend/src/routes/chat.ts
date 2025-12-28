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

// Get chat info by chat_id (for notification click handling)
router.get('/info/:chatId', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const chatId = String(req.params.chatId || '');

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!chatId) return res.status(400).json({ error: 'Missing chat_id' });

    const schemaMode = await getChatsSchemaMode();

    // Get chat info
    const chatResult = await pool.query(
      `SELECT id, booking_id, user_a, user_b, created_at, updated_at FROM chats WHERE id::text = $1`,
      [chatId]
    );

    if (!chatResult.rows[0]) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const chat = chatResult.rows[0];

    // Get booking info if this is a booking chat
    let booking = null;
    if (chat.booking_id) {
      const bookingResult = await pool.query(
        `SELECT b.id, b.client_id, b.provider_id, s.title as service_title,
                u1.name as client_name, u2.name as provider_name
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN users u1 ON u1.id = b.client_id
         LEFT JOIN users u2 ON u2.id = b.provider_id
         WHERE b.id::text = $1`,
        [String(chat.booking_id)]
      );
      booking = bookingResult.rows[0] || null;
    }

    // Check access - user must be part of this chat
    const userA = String(chat.user_a || '');
    const userB = String(chat.user_b || '');
    const clientId = booking ? String(booking.client_id || '') : '';
    const providerId = booking ? String(booking.provider_id || '') : '';

    const hasAccess = [userA, userB, clientId, providerId].includes(String(currentUserId));
    if (!hasAccess) {
      return res.status(403).json({ error: 'Access denied' });
    }

    return res.json({
      data: {
        chat_id: chat.id,
        booking_id: chat.booking_id,
        booking,
      }
    });
  } catch (error) {
    console.error('Error getting chat info:', error);
    return res.status(500).json({ error: 'Failed to get chat info' });
  }
});

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
        String(currentUserId),
        senderName,
        String(chat.id),
        content?.substring(0, 100) || (file ? 'Sent an attachment' : 'New message'),
        bookingId
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

// ============================================
// DIRECT MESSAGING (without booking required)
// ============================================

// Helper to create or get a direct chat between two users
async function ensureDirectChat(userA: string, userB: string): Promise<ChatRow> {
  // Check if chat already exists between these users
  const existingChat = await pool.query(
    `SELECT * FROM chats
     WHERE booking_id IS NULL
     AND ((user_a::text = $1 AND user_b::text = $2) OR (user_a::text = $2 AND user_b::text = $1))
     LIMIT 1`,
    [userA, userB]
  );

  if (existingChat.rows[0]) {
    return existingChat.rows[0];
  }

  // Create new direct chat
  const newChat = await pool.query(
    `INSERT INTO chats (user_a, user_b, booking_id)
     VALUES ($1, $2, NULL)
     RETURNING *`,
    [userA, userB]
  );

  return newChat.rows[0];
}

// Create or get a direct chat with another user
router.post('/direct', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const recipientId = String(req.body?.recipient_id || '');

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!recipientId) return res.status(400).json({ error: 'Missing recipient_id' });
    if (currentUserId === recipientId) return res.status(400).json({ error: 'Cannot chat with yourself' });

    // Verify recipient exists
    const recipientCheck = await pool.query('SELECT id, name FROM users WHERE id::text = $1', [recipientId]);
    if (!recipientCheck.rows[0]) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const chat = await ensureDirectChat(currentUserId, recipientId);

    return res.json({
      data: {
        chat_id: chat.id,
        recipient: recipientCheck.rows[0],
      }
    });
  } catch (error) {
    console.error('Error creating direct chat:', error);
    return res.status(500).json({ error: 'Failed to create chat' });
  }
});

// Get direct chat history
router.get('/direct/:recipientId/history', verifyToken, async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const recipientId = String(req.params.recipientId || '');
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!recipientId) return res.status(400).json({ error: 'Missing recipient_id' });

    // Find the direct chat
    const chatResult = await pool.query(
      `SELECT * FROM chats
       WHERE booking_id IS NULL
       AND ((user_a::text = $1 AND user_b::text = $2) OR (user_a::text = $2 AND user_b::text = $1))
       LIMIT 1`,
      [currentUserId, recipientId]
    );

    if (!chatResult.rows[0]) {
      // No chat exists yet, return empty
      return res.json({
        data: {
          chat: null,
          messages: [],
        }
      });
    }

    const chat = chatResult.rows[0];

    // Get messages
    const msgs = await pool.query(
      `SELECT id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
       FROM chat_messages
       WHERE chat_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [chat.id, limit]
    );

    // Mark messages as read
    await pool.query(
      `UPDATE chat_messages
       SET read_at = CURRENT_TIMESTAMP
       WHERE chat_id = $1
         AND sender_id IS NOT NULL
         AND sender_id::text <> $2
         AND read_at IS NULL`,
      [chat.id, currentUserId]
    );

    return res.json({
      data: {
        chat: { id: chat.id, user_a: chat.user_a, user_b: chat.user_b },
        messages: msgs.rows,
      }
    });
  } catch (error) {
    console.error('Error fetching direct chat history:', error);
    return res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

// Send message in direct chat
router.post('/direct/:recipientId/send', verifyToken, upload.single('file'), async (req: AuthedRequest, res: Response) => {
  try {
    const currentUserId = req.userId;
    const recipientId = String(req.params.recipientId || '');
    const content = String(req.body?.content || '').trim();
    const file = (req as any).file;

    if (!currentUserId) return res.status(401).json({ error: 'Unauthorized' });
    if (!recipientId) return res.status(400).json({ error: 'Missing recipient_id' });
    if (!content && !file) return res.status(400).json({ error: 'Missing content or file' });

    // Verify recipient exists
    const recipientCheck = await pool.query('SELECT id, name FROM users WHERE id::text = $1', [recipientId]);
    if (!recipientCheck.rows[0]) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    // Create or get chat
    const chat = await ensureDirectChat(currentUserId, recipientId);

    const attachmentUrl = file ? `chats/direct/${chat.id}/${file.filename}` : null;
    const attachmentName = file ? file.originalname : null;
    const attachmentType = file
      ? file.mimetype.startsWith('image/') ? 'image' : 'file'
      : null;

    // Insert message
    const insert = await pool.query(
      `INSERT INTO chat_messages (chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at`,
      [chat.id, currentUserId, content || null, attachmentUrl, attachmentType, attachmentName]
    );

    await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [String(chat.id)]);

    const sent = insert.rows[0];

    // Emit via Socket.IO
    const io = (req.app as any).get('io');
    if (io) {
      io.to(`user:${recipientId}`).emit('chat:message', {
        chatId: chat.id,
        message: sent,
        isDirect: true,
      });
    }

    // Send notification
    try {
      const senderInfo = await pool.query('SELECT name FROM users WHERE id::text = $1', [currentUserId]);
      const senderName = senderInfo.rows[0]?.name || 'Someone';

      await notificationService.notifyNewMessage(
        recipientId,
        currentUserId,
        senderName,
        String(chat.id),
        content?.substring(0, 100) || (file ? 'Sent an attachment' : 'New message')
        // No bookingId for direct messages
      );
    } catch (notifError) {
      console.error('Failed to send direct chat notification:', notifError);
    }

    return res.status(201).json({ data: sent });
  } catch (error) {
    console.error('Error sending direct message:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
});

export default router;
