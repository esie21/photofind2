import { Router, Request, Response } from 'express';
import { verifyToken } from '../middleware/auth';
import { pool } from '../config/database';

interface AuthedRequest extends Request {
  userId?: string;
}

const router = Router();

let chatsSchemaChecked = false;
let messagesSchemaChecked = false;
let messagesReadMode: 'read_at' | 'is_read' | 'none' = 'none';

async function ensureChatsSchema() {
  if (chatsSchemaChecked) return;

  const queries = [
    `ALTER TABLE chats ADD COLUMN IF NOT EXISTS booking_id TEXT;`,
    `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_a TEXT;`,
    `ALTER TABLE chats ADD COLUMN IF NOT EXISTS user_b TEXT;`,
    `ALTER TABLE chats ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
    `ALTER TABLE chats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`,
  ];

  for (const sql of queries) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('Chat schema migration failed:', e);
    }
  }

  const bestEffort = [
    `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_user_a_fkey;`,
    `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_user_b_fkey;`,
    `ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_booking_id_fkey;`,
    `ALTER TABLE chats ALTER COLUMN booking_id TYPE TEXT USING booking_id::text;`,
    `ALTER TABLE chats ALTER COLUMN user_a TYPE TEXT USING user_a::text;`,
    `ALTER TABLE chats ALTER COLUMN user_b TYPE TEXT USING user_b::text;`,
  ];

  for (const sql of bestEffort) {
    try {
      await pool.query(sql);
    } catch (e) {
      console.error('Chat schema migration failed:', e);
    }
  }

  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_chats_direct_pair ON chats (user_a, user_b) WHERE booking_id IS NULL;`
    );
  } catch (e) {
    console.error('Chat schema migration failed:', e);
  }

  chatsSchemaChecked = true;
}

async function ensureMessagesSchema() {
  if (messagesSchemaChecked) return;

  try {
    const cols = await pool.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'messages'
      `
    );
    const names = new Set<string>(cols.rows.map((r: any) => String(r.column_name)));
    if (names.has('read_at')) {
      messagesReadMode = 'read_at';
    } else if (names.has('is_read')) {
      messagesReadMode = 'is_read';
    } else {
      messagesReadMode = 'none';
    }
  } catch (e) {
    console.error('Messages schema check failed:', e);
    messagesReadMode = 'none';
  }

  messagesSchemaChecked = true;
}

type ChatRow = {
  id: string;
  user_a: string; // Changed to string for UUID
  user_b: string; // Changed to string for UUID
  created_at: string;
  updated_at: string;
};

function normalizeParticipantIds(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

async function ensureChatExists(
  currentUserId: string,
  otherUserId: string
): Promise<ChatRow | null> {
  await ensureChatsSchema();
  const [userA, userB] = normalizeParticipantIds(currentUserId, otherUserId);
  const result = await pool.query<ChatRow>(
    `
      INSERT INTO chats (booking_id, user_a, user_b)
      VALUES (NULL, $1, $2)
      ON CONFLICT (user_a, user_b) WHERE booking_id IS NULL
      DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [userA, userB]
  );
  return result.rows[0] || null;
}

async function getChatForUser(
  chatId: string,
  currentUserId: string
) {
  const result = await pool.query<ChatRow>(
    'SELECT * FROM chats WHERE id = $1',
    [chatId]
  );
  const chat = result.rows[0];
  if (!chat) return null;
  if (![chat.user_a, chat.user_b].includes(currentUserId)) {
    return 'forbidden';
  }
  return chat;
}

function formatUser(row: any) {
  if (!row) return null;
  return {
    id: row.other_user_id,
    name: row.other_user_name,
    profile_image: row.other_user_profile_image,
  };
}

// Create (or fetch) a conversation with another user
router.post(
  '/conversations',
  verifyToken,
  async (req: AuthedRequest, res: Response) => {
    try {
      const currentUserId = req.userId; // Removed Number() conversion
      const { other_user_id } = req.body || {};
      const otherUserId = other_user_id; // Removed Number() conversion

      console.log('Create conversation request:', { currentUserId, otherUserId });

      if (!currentUserId || !otherUserId) {
        console.log('Missing participant:', { currentUserId, otherUserId });
        return res.status(400).json({ error: 'Missing participant' });
      }
      
      if (currentUserId === otherUserId) {
        return res
          .status(400)
          .json({ error: 'Cannot create conversation with yourself' });
      }

      const otherExists = await pool.query(
        'SELECT id, name, profile_image FROM users WHERE id = $1',
        [otherUserId]
      );
      
      if (otherExists.rows.length === 0) {
        return res.status(404).json({ error: 'Participant not found' });
      }

      const chat = await ensureChatExists(currentUserId, otherUserId);
      
      if (!chat) {
        return res.status(500).json({ error: 'Unable to create conversation' });
      }

      return res.json({
        ...chat,
        other_user: {
          id: otherExists.rows[0].id,
          name: otherExists.rows[0].name,
          profile_image: otherExists.rows[0].profile_image,
        },
      });
    } catch (error) {
      console.error('Error creating conversation', error);
      return res.status(500).json({ error: 'Failed to create conversation' });
    }
  }
);

// List conversations for the current user
router.get(
  '/conversations',
  verifyToken,
  async (req: AuthedRequest, res: Response) => {
    try {
      const currentUserId = req.userId; // Removed Number() conversion
      await ensureChatsSchema();
      await ensureMessagesSchema();

      const lastMessageSelect =
        messagesReadMode === 'read_at'
          ? 'm.read_at'
          : messagesReadMode === 'is_read'
            ? 'CASE WHEN m.is_read THEN m.created_at ELSE NULL END AS read_at'
            : 'NULL::timestamp AS read_at';

      const result = await pool.query(
        `
        SELECT 
          c.*,
          CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END AS other_user_id,
          u.name AS other_user_name,
          u.profile_image AS other_user_profile_image,
          lm.id AS last_message_id,
          lm.content AS last_message_content,
          lm.sender_id AS last_message_sender_id,
          lm.created_at AS last_message_created_at
        FROM chats c
        JOIN users u ON u.id::text = CASE WHEN c.user_a = $1 THEN c.user_b ELSE c.user_a END
        LEFT JOIN LATERAL (
          SELECT m.id, m.content, m.sender_id, m.created_at, ${lastMessageSelect}
          FROM messages m
          WHERE m.chat_id::text = c.id::text
          ORDER BY m.created_at DESC
          LIMIT 1
        ) lm ON TRUE
        WHERE (c.user_a = $1 OR c.user_b = $1) AND c.booking_id IS NULL
        ORDER BY c.updated_at DESC
        `,
        [currentUserId]
      );

      const conversations = result.rows.map((row: any) => ({
        id: row.id,
        user_a: row.user_a,
        user_b: row.user_b,
        created_at: row.created_at,
        updated_at: row.updated_at,
        other_user: formatUser(row),
        last_message: row.last_message_id
          ? {
              id: row.last_message_id,
              content: row.last_message_content,
              sender_id: row.last_message_sender_id,
              created_at: row.last_message_created_at,
            }
          : null,
      }));

      return res.json({ data: conversations });
    } catch (error) {
      console.error('Error listing conversations', error);
      return res.status(500).json({ error: 'Failed to load conversations' });
    }
  }
);

// Get messages for a conversation
router.get(
  '/conversations/:id/messages',
  verifyToken,
  async (req: AuthedRequest, res: Response) => {
    try {
      const chatId = String(req.params.id);
      const currentUserId = req.userId; // Removed Number() conversion
      const limit = Math.min(
        200,
        Math.max(1, Number(req.query.limit) || 50)
      );

      await ensureChatsSchema();
      await ensureMessagesSchema();

      const chat = await getChatForUser(chatId, currentUserId!);
      
      if (chat === null) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (chat === 'forbidden') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const selectReadAt =
        messagesReadMode === 'read_at'
          ? 'read_at'
          : messagesReadMode === 'is_read'
            ? 'CASE WHEN is_read THEN created_at ELSE NULL END AS read_at'
            : 'NULL::timestamp AS read_at';

      const messages = await pool.query(
        `
          SELECT id, chat_id as conversation_id, sender_id, content, created_at, ${selectReadAt}
          FROM messages
          WHERE chat_id::text = $1
          ORDER BY created_at ASC
          LIMIT $2
        `,
        [chatId, limit]
      );

      try {
        if (messagesReadMode === 'read_at') {
          await pool.query(
            `
              UPDATE messages
              SET read_at = CURRENT_TIMESTAMP
              WHERE chat_id::text = $1
                AND sender_id::text <> $2
                AND read_at IS NULL
            `,
            [chatId, currentUserId]
          );
        }
        if (messagesReadMode === 'is_read') {
          await pool.query(
            `
              UPDATE messages
              SET is_read = TRUE
              WHERE chat_id::text = $1
                AND sender_id::text <> $2
                AND (is_read IS NULL OR is_read = FALSE)
            `,
            [chatId, currentUserId]
          );
        }
      } catch (e) {
        console.error('Failed to mark messages as read:', e);
      }

      return res.json({ data: messages.rows });
    } catch (error) {
      console.error('Error fetching messages', error);
      return res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }
);

// Send a message inside a conversation
router.post(
  '/',
  verifyToken,
  async (req: AuthedRequest, res: Response) => {
    try {
      const { conversation_id, content } = req.body || {};
      const chatId = String(conversation_id);
      const currentUserId = req.userId; // Removed Number() conversion

      if (!chatId || !content || !content.trim()) {
        return res.status(400).json({ error: 'Missing content or conversation' });
      }

      await ensureChatsSchema();
      await ensureMessagesSchema();

      const chat = await getChatForUser(chatId, currentUserId!);
      
      if (chat === null) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      if (chat === 'forbidden') {
        return res.status(403).json({ error: 'Access denied' });
      }

      const returningReadAt =
        messagesReadMode === 'read_at'
          ? 'read_at'
          : messagesReadMode === 'is_read'
            ? 'CASE WHEN is_read THEN created_at ELSE NULL END AS read_at'
            : 'NULL::timestamp AS read_at';

      const insert = await pool.query(
        `
          INSERT INTO messages (chat_id, sender_id, content)
          VALUES ($1, $2, $3)
          RETURNING id, chat_id as conversation_id, sender_id, content, created_at, ${returningReadAt}
        `,
        [chatId, currentUserId, content.trim()]
      );

      await pool.query(
        'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [chatId]
      );

      return res.status(201).json(insert.rows[0]);
    } catch (error) {
      console.error('Error sending message', error);
      return res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

export default router;