import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { testConnection, initializeTables } from './config/database';
import { pool } from './config/database';
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import debugRoutes from './routes/debug';
import usersRoutes from './routes/users';
import providersRoutes from './routes/providers';
import bookingsRoutes from './routes/bookings';
import availabilityRoutes from './routes/availability';
import servicesRoutes from './routes/services';
import messagesRoutes from './routes/messages';
import chatRoutes from './routes/chat';
import paymentsRoutes from './routes/payments';
import walletRoutes from './routes/wallet';
import payoutsRoutes from './routes/payouts';
import notificationsRoutes from './routes/notifications';
import reviewsRoutes from './routes/reviews';
import { notificationService } from './services/notificationService';
import path from 'path';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import type { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';

// Security middleware imports
import {
  helmetMiddleware,
  generalLimiter,
  authSecurityStack,
  paymentSecurityStack,
  chatSecurityStack,
  adminSecurityStack,
  xssSanitizer,
  csrfTokenSetter,
} from './middleware/security';

dotenv.config();

const app: Express = express();

// ==============================================
// CORS MUST BE FIRST (before other middleware)
// ==============================================

// CORS - allow all origins for now
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
}));
app.options('*', cors());
// ==============================================
// SECURITY MIDDLEWARE
// ==============================================

// Helmet security headers
app.use(helmetMiddleware);

// Cookie parser for CSRF tokens
app.use(cookieParser());

// Body parser with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// XSS sanitization for all requests
app.use(xssSanitizer);

// CSRF token setter for GET requests
app.use(csrfTokenSetter);

// General rate limiting for all routes
app.use('/api', (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }
  return generalLimiter(req, res, next);
});


// ==============================================
// ROUTES WITH SECURITY MIDDLEWARE
// ==============================================

// Auth routes - strict rate limiting
app.use('/api/auth', authSecurityStack, authRoutes);

// Admin routes - admin-specific security
app.use('/api/admin', adminSecurityStack, adminRoutes);

// Payment routes - payment-specific security
app.use('/api/payments', paymentSecurityStack, paymentsRoutes);
app.use('/api/wallet', paymentSecurityStack, walletRoutes);
app.use('/api/payouts', paymentSecurityStack, payoutsRoutes);

// Chat routes - chat-specific rate limiting
app.use('/api/chat', chatSecurityStack, chatRoutes);
app.use('/api/messages', chatSecurityStack, messagesRoutes);

// Standard protected routes
app.use('/api/users', usersRoutes);
app.use('/api/providers', providersRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/reviews', reviewsRoutes);

// Register debug routes only in non-production
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/debug', debugRoutes);
}

// Serve uploaded media from project root 'uploads' directory
// Use two-levels-up relative path so backend/src -> ../.. -> project root
app.use('/uploads', express.static(path.resolve(__dirname, '../../uploads')));

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'Server is running' });
});

const PORT = process.env.PORT || 3001;

const httpServer = http.createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

app.set('io', io);

// Set Socket.IO instance for notification service
notificationService.setSocketIO(io);

type PresenceMap = Map<string, Set<string>>;
const bookingPresence: PresenceMap = new Map();

function getRoomName(bookingId: string) {
  return `booking:${bookingId}`;
}

async function ensureBookingChat(bookingId: string) {
  const bookingRes = await pool.query(
    'SELECT id, client_id, provider_id FROM bookings WHERE id::text = $1',
    [bookingId]
  );
  const booking = bookingRes.rows[0];
  if (!booking) return null;

  const existing = await pool.query('SELECT id FROM chats WHERE booking_id::text = $1', [bookingId]);
  if (existing.rows[0]) {
    return { chatId: String(existing.rows[0].id), booking };
  }

  const created = await pool.query(
    'INSERT INTO chats (booking_id, user_a, user_b) VALUES ($1, $2, $3) RETURNING id',
    [String(bookingId), String(booking.client_id), String(booking.provider_id)]
  );
  return { chatId: String(created.rows[0].id), booking };
}

function addPresence(bookingId: string, userId: string) {
  const set = bookingPresence.get(bookingId) || new Set<string>();
  set.add(userId);
  bookingPresence.set(bookingId, set);
}

function removePresence(bookingId: string, userId: string) {
  const set = bookingPresence.get(bookingId);
  if (!set) return;
  set.delete(userId);
  if (set.size === 0) bookingPresence.delete(bookingId);
}

io.use((socket: Socket, next: (err?: Error) => void) => {
  const token =
    (socket.handshake.auth as any)?.token ||
    socket.handshake.headers.authorization?.toString().split(' ')[1];

  if (!token) return next(new Error('Unauthorized'));

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    (socket.data as any).userId = String(decoded.userId);
    next();
  } catch (_e) {
    next(new Error('Unauthorized'));
  }
});

io.on('connection', (socket: Socket) => {
  const userId = String((socket.data as any).userId || '');
  (socket.data as any).joinedBookings = new Set<string>();

  // Join user's personal notification room
  if (userId) {
    socket.join(`user:${userId}`);
    console.log(`User ${userId} connected and joined notification room`);
  }

  socket.on('chat:join', async (payload: any) => {
    const bookingId = String(payload?.bookingId || '');
    if (!bookingId) return;

    const bookingRes = await pool.query(
      'SELECT id, client_id, provider_id FROM bookings WHERE id::text = $1',
      [bookingId]
    );
    const booking = bookingRes.rows[0];
    if (!booking) return;

    if (String(booking.client_id) !== userId && String(booking.provider_id) !== userId) return;

    const room = getRoomName(bookingId);
    socket.join(room);
    (socket.data as any).joinedBookings.add(bookingId);
    addPresence(bookingId, userId);
    io.to(room).emit('chat:presence', { bookingId, userId, online: true });
  });

  socket.on('chat:typing', (payload: any) => {
    const bookingId = String(payload?.bookingId || '');
    const isTyping = Boolean(payload?.isTyping);
    if (!bookingId) return;
    socket.to(getRoomName(bookingId)).emit('chat:typing', {
      bookingId,
      userId,
      isTyping,
    });
  });

  socket.on('chat:read', async (payload: any) => {
    const bookingId = String(payload?.bookingId || '');
    if (!bookingId) return;

    const ensured = await ensureBookingChat(bookingId);
    if (!ensured) return;

    await pool.query(
      `
        UPDATE chat_messages
        SET read_at = CURRENT_TIMESTAMP
        WHERE chat_id = $1
          AND sender_id IS NOT NULL
          AND sender_id <> $2
          AND read_at IS NULL
      `,
      [ensured.chatId, userId]
    );

    io.to(getRoomName(bookingId)).emit('chat:read', {
      bookingId,
      readerId: userId,
      readAt: new Date().toISOString(),
    });
  });

  socket.on('chat:send', async (payload: any) => {
    const bookingId = String(payload?.bookingId || '');
    const content = String(payload?.content || '').trim();
    if (!bookingId || !content) return;

    const ensured = await ensureBookingChat(bookingId);
    if (!ensured) return;
    if (String(ensured.booking.client_id) !== userId && String(ensured.booking.provider_id) !== userId) return;

    const inserted = await pool.query(
      `
        INSERT INTO chat_messages (chat_id, sender_id, content, is_system)
        VALUES ($1, $2, $3, FALSE)
        RETURNING id, chat_id, sender_id, content, attachment_url, attachment_type, attachment_name, is_system, created_at, read_at
      `,
      [ensured.chatId, userId, content]
    );

    await pool.query('UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id::text = $1', [ensured.chatId]);

    io.to(getRoomName(bookingId)).emit('chat:message', {
      bookingId,
      message: inserted.rows[0],
    });
  });

  socket.on('disconnect', () => {
    const joined: Set<string> = (socket.data as any).joinedBookings || new Set<string>();
    joined.forEach((bookingId) => {
      removePresence(bookingId, userId);
      io.to(getRoomName(bookingId)).emit('chat:presence', { bookingId, userId, online: false });
    });
  });
});

async function startServer() {
  try {
    // Test database connection
    await testConnection();

    // Initialize tables
    await initializeTables();

    httpServer.listen(PORT, () => {
      console.log(`\n✅ Server running on http://localhost:${PORT}`);
      console.log(`📱 Frontend connects to: http://localhost:${PORT}/api`);
      console.log(`🗄️  Database: ${process.env.DB_NAME}`);
      console.log(`📊 Server: ${process.env.DB_HOST}\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
